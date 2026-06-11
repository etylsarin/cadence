#!/usr/bin/env python3
"""
pipeline.py — Sync full pipeline runner.

Stages run IN-PROCESS (imported and called, not subprocessed). The server
isolates all sync work by launching this script as a subprocess
(see sync/router.py::_run_sync), so the stages themselves no longer need their
own process boundaries — running them in-process gives real exceptions,
structured results, and a single config/import load.

Stages:
  fetch           : _gettickets.run()     (download / update bronze from Jira)
  repair          : _repair.run()         (reverse false deletions in bronze)
  bronze → silver : _bronze2silver.run()  (clean bronze JSON → silver)
  silver → gold   : _silver2gold.run()    (compute metrics CSVs)

All output is streamed to the terminal and written to a timestamped log file
in logs/ (YYYY-MM-DDTHH-MM-SSZ.log).

Usage:
  ./pipeline.py                # run all stages (default)
  ./pipeline.py --all          # same
  ./pipeline.py --silver-only  # silver → gold only (no Jira API calls)
  ./pipeline.py --gold-only    # alias for --silver-only
  ./pipeline.py --force        # re-download all tickets in the fetch stage
"""

import argparse
import contextlib
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))  # sibling stage modules
sys.path.insert(0, str(SCRIPT_DIR.parent.parent))  # backend/ for config

DATA_DIR = SCRIPT_DIR.parent.parent / "data"
LOG_DIR = DATA_DIR / "logs"

import _bronze2silver  # noqa: E402
import _gettickets  # noqa: E402
import _repair  # noqa: E402
import _silver2gold  # noqa: E402


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class _Tee:
    """File-like object that writes to the real stdout and the log file at once.

    Used as a redirect_stdout/redirect_stderr target so an in-process stage's
    print() calls stream to the terminal and are captured in the log, exactly as
    the old subprocess tee did.
    """

    def __init__(self, log_fh):
        self._log = log_fh

    def write(self, s):
        sys.__stdout__.write(s)
        sys.__stdout__.flush()
        self._log.write(s)
        self._log.flush()

    def flush(self):
        sys.__stdout__.flush()
        self._log.flush()


def _stage_exit_code(label: str, result) -> int:
    """Derive a subprocess-style exit code from a stage's structured result."""
    if result is None:
        return 1
    if label == "fetch":
        return 1 if result.errors else 0
    if label == "repair":
        return 0
    if label == "bronze→silver":
        return 1 if result.errors else 0
    if label == "silver→gold":
        return 0 if (result.ran and not result.failed) else 1
    return 0


def run_stage(label: str, fn, tee: _Tee):
    """Run a stage function in-process, teeing its output to stdout + log.

    Returns (result, exit_code). exit_code is 1 on an uncaught exception,
    otherwise derived from the stage's structured result — matching the codes
    the previous subprocess stages returned.
    """
    tee.write(f"\n[{label}]  started={utcnow()}\n")
    result, exit_code = None, 0
    try:
        with contextlib.redirect_stdout(tee), contextlib.redirect_stderr(tee):
            result = fn()
    except Exception as e:
        exit_code = 1
        tee.write(f"[{label}] EXCEPTION: {e}\n")
        tee.write(traceback.format_exc())
    else:
        exit_code = _stage_exit_code(label, result)
    tee.write(f"[{label}]  finished={utcnow()}  exit={exit_code}\n")
    return result, exit_code


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--all",
        dest="mode",
        action="store_const",
        const="all",
        help="run all stages (default)",
    )
    group.add_argument(
        "--silver-only",
        dest="mode",
        action="store_const",
        const="silver",
        help="run silver→gold only (no Jira API calls)",
    )
    group.add_argument(
        "--gold-only",
        dest="mode",
        action="store_const",
        const="silver",
        help="alias for --silver-only",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-download all tickets in the fetch stage",
    )
    args = parser.parse_args()

    mode = args.mode or "all"
    run_fetch = mode == "all"
    run_b2s = mode == "all"
    run_s2g = mode in ("all", "silver")

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{utcnow().replace(':', '-')}.log"

    # Append mode (O_APPEND): the fetch stage's log() lines are directed at this
    # same file via log_path (below), and its print() output is tee'd here too.
    # Both writers append at EOF, so the lines interleave cleanly in one log.
    with open(log_path, "a") as log_fh:
        tee = _Tee(log_fh)
        stages = (["fetch", "repair", "bronze→silver"] if run_fetch else []) + (
            ["silver→gold"] if run_s2g else []
        )
        tee.write(f"Sync pipeline  started={utcnow()}\n")
        tee.write(f"Stages: {', '.join(stages)}\n")

        if run_fetch:
            _, code = run_stage(
                "fetch",
                lambda: _gettickets.run(force=args.force, log_path=log_path),
                tee,
            )
            if code != 0:
                tee.write(f"\nERROR: fetch exited {code} — aborting.\n")
                return code

            _, code = run_stage("repair", lambda: _repair.run(apply=True), tee)
            if code != 0:
                tee.write(f"\nERROR: repair exited {code} — aborting.\n")
                return code

        if run_b2s:
            _, code = run_stage("bronze→silver", lambda: _bronze2silver.run(), tee)
            if code != 0:
                tee.write(f"\nERROR: bronze→silver exited {code} — aborting.\n")
                return code

        if run_s2g:
            _, code = run_stage("silver→gold", lambda: _silver2gold.run(), tee)
            if code != 0:
                tee.write(f"\nERROR: silver→gold exited {code}.\n")
                return code

        tee.write(f"\nDone.  log={log_path.name}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
