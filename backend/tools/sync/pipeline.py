#!/usr/bin/env python3
"""
pipeline.py — Sync full pipeline runner.

Stages:
  fetch           : _gettickets.py     (download / update bronze from Jira)
  repair          : _repair.py         (reverse false deletions in bronze)
  bronze → silver : _bronze2silver.py  (clean bronze JSON → silver)
  silver → gold   : _silver2gold.py    (compute metrics CSVs)

All output is streamed to the terminal and written to a timestamped log file
in logs/ (YYYY-MM-DDTHH-MM-SSZ.log).

Usage:
  ./pipeline.py                # run all stages (default)
  ./pipeline.py --all          # same
  ./pipeline.py --silver-only  # silver → gold only (no Jira API calls)
  ./pipeline.py --gold-only    # alias for --silver-only
  ./pipeline.py --force        # pass --force to _gettickets.py (re-download all)
"""

import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DATA_DIR   = SCRIPT_DIR.parent.parent / "data"
LOG_DIR    = DATA_DIR / "logs"


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def tee(text: str, log_fh):
    sys.stdout.write(text)
    sys.stdout.flush()
    log_fh.write(text)
    log_fh.flush()


def run_stage(label: str, cmd: list, log_fh) -> int:
    """Run a subprocess, streaming output to both stdout and log. Returns exit code."""
    tee(f"\n[{label}]  started={utcnow()}\n", log_fh)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    for line in proc.stdout:
        tee(line, log_fh)
    proc.wait()

    tee(f"[{label}]  finished={utcnow()}  exit={proc.returncode}\n", log_fh)
    return proc.returncode


# ── CLI ───────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(
    description=__doc__,
    formatter_class=argparse.RawDescriptionHelpFormatter,
)
group = parser.add_mutually_exclusive_group()
group.add_argument("--all",         dest="mode", action="store_const", const="all",
                   help="run all stages (default)")
group.add_argument("--silver-only", dest="mode", action="store_const", const="silver",
                   help="run silver→gold only (no Jira API calls)")
group.add_argument("--gold-only",   dest="mode", action="store_const", const="silver",
                   help="alias for --silver-only")
parser.add_argument("--force", action="store_true",
                    help="pass --force to _gettickets.py (re-download all tickets)")
args = parser.parse_args()

mode      = args.mode or "all"
run_fetch = mode == "all"
run_b2s   = mode == "all"
run_s2g   = mode in ("all", "silver")

# ── Run ───────────────────────────────────────────────────────────────────────

LOG_DIR.mkdir(parents=True, exist_ok=True)
log_path = LOG_DIR / f"{utcnow().replace(':', '-')}.log"

with open(log_path, "w") as log_fh:
    stages = (["fetch", "repair", "bronze→silver"] if run_fetch else []) + (["silver→gold"] if run_s2g else [])
    banner = (
        f"Sync pipeline  started={utcnow()}\n"
        f"Stages: {', '.join(stages)}\n"
    )
    tee(banner, log_fh)

    if run_fetch:
        cmd = [sys.executable, str(SCRIPT_DIR / "_gettickets.py")]
        if args.force:
            cmd.append("--force")
        rc = run_stage("fetch", cmd, log_fh)
        if rc != 0:
            tee(f"\nERROR: fetch exited {rc} — aborting.\n", log_fh)
            sys.exit(rc)

        rc = run_stage("repair", [sys.executable, str(SCRIPT_DIR / "_repair.py"), "--apply"], log_fh)
        if rc != 0:
            tee(f"\nERROR: repair exited {rc} — aborting.\n", log_fh)
            sys.exit(rc)

    if run_b2s:
        rc = run_stage("bronze→silver", [sys.executable, str(SCRIPT_DIR / "_bronze2silver.py")], log_fh)
        if rc != 0:
            tee(f"\nERROR: bronze→silver exited {rc} — aborting.\n", log_fh)
            sys.exit(rc)

    if run_s2g:
        rc = run_stage("silver→gold", [sys.executable, str(SCRIPT_DIR / "_silver2gold.py")], log_fh)
        if rc != 0:
            tee(f"\nERROR: silver→gold exited {rc}.\n", log_fh)
            sys.exit(rc)

    tee(f"\nDone.  log={log_path.name}\n", log_fh)
