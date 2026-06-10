"""Sync management — FastAPI router.

All routes are mounted under the /sync prefix by server.py.
"""

import csv
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import PlainTextResponse

from config import load_config, PROJECTS, SYNC_ISSUE_TYPES, SYNC_START_DATE

router = APIRouter()

SYNC_DIR = Path(__file__).parent.resolve()
DATA_DIR   = SYNC_DIR.parent.parent / "data"

# ── In-memory sync state ──────────────────────────────────────────────────────
_sync_lock  = threading.Lock()
_sync_state: dict = {"running": False, "started_at": None}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _csv_stats() -> dict:
    stats: dict = {}
    gold = DATA_DIR / "gold"
    for name in ["escaped_defects", "throughput", "flow_metrics"]:
        path = gold / f"{name}.csv"
        try:
            with open(path, newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
            stats[name] = {"rows": len(rows), "updated_at": mtime}
        except Exception:
            stats[name] = {"rows": None, "updated_at": None}
    return stats


def _last_sync() -> Optional[str]:
    # Stored under data/ (the persistent volume) so the timestamp
    # survives container revisions. Written by _gettickets.sh.
    try:
        return (DATA_DIR / "last_sync.txt").read_text().strip()
    except Exception:
        return None


def _count_bronze() -> Optional[int]:
    try:
        return sum(1 for f in (DATA_DIR / "bronze").iterdir()
                   if f.suffix == ".json" and not f.stem.endswith(".meta"))
    except Exception:
        return None


def _count_silver() -> Optional[int]:
    try:
        return sum(1 for f in (DATA_DIR / "silver").iterdir()
                   if f.suffix == ".json")
    except Exception:
        return None


def _parse_log_summary(path: Path) -> dict:
    """Extract summary fields from a log file (handles both sync.sh and pipeline.py formats)."""
    result: dict = {}
    is_pipeline = False
    stages_failed = []
    try:
        with open(path) as f:
            for line in f:
                # ── pipeline.py format ────────────────────────────────────────
                if "Sync pipeline  started=" in line:
                    is_pipeline = True
                    result["type"] = "pipeline"
                    ts = line.strip().split("started=", 1)
                    if len(ts) > 1:
                        result["started_at"] = ts[1].strip()
                elif is_pipeline and line.startswith("Stages: "):
                    result["stages"] = line.strip()[len("Stages: "):]
                elif is_pipeline and "  finished=" in line and "  exit=" in line:
                    # "[bronze→silver]  finished=...  exit=0"
                    label = line.strip().split("]")[0].lstrip("[")
                    exit_val = line.strip().split("exit=")[-1].strip()
                    if exit_val != "0":
                        stages_failed.append(label)
                elif is_pipeline and line.strip().startswith("Done."):
                    result["done"] = True
                # ── sync.sh output (embedded inside pipeline fetch stage) ──
                elif "DISCOVER  " in line:
                    parts = line.strip().split("DISCOVER  ", 1)
                    if len(parts) > 1:
                        result["tickets"] = parts[1].split()[0]
                elif "  SUMMARY  " in line:
                    tail = line.strip().split("  SUMMARY  ", 1)[1]
                    for part in tail.split():
                        if "=" in part:
                            k, v = part.split("=", 1)
                            result[k] = v
    except Exception:
        pass
    if stages_failed:
        result["errors"] = str(len(stages_failed))
        result["failed_stages"] = stages_failed
    return result


def _list_logs() -> list:
    logs_dir = DATA_DIR / "logs"
    result = []
    try:
        for f in sorted(logs_dir.glob("*.log"), reverse=True)[:30]:
            summary = _parse_log_summary(f)
            m = re.match(r'^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.log$', f.name)
            if m:
                try:
                    start = datetime.fromisoformat(
                        f"{m.group(1)}T{m.group(2)}:{m.group(3)}:{m.group(4)}+00:00"
                    )
                    end = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
                    summary['duration_s'] = int((end - start).total_seconds())
                except Exception:
                    pass
            result.append({"name": f.name, "summary": summary})
    except Exception:
        pass
    return result


def _run_sync(force: bool = False):
    try:
        cmd = [sys.executable, str(SYNC_DIR / "pipeline.py"), "--all"]
        if force:
            cmd.append("--force")
        subprocess.run(cmd, cwd=str(SYNC_DIR), capture_output=True)
    finally:
        with _sync_lock:
            _sync_state["running"]    = False
            _sync_state["started_at"] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/status")
def api_status():
    with _sync_lock:
        running    = _sync_state["running"]
        started_at = _sync_state["started_at"]

    secrets = load_config()
    return {
        "running":      running,
        "started_at":   started_at,
        "last_sync":    _last_sync(),
        "bronze_count": _count_bronze(),
        "silver_count": _count_silver(),
        "csv_stats":    _csv_stats(),
        "config": {
            "jira_url":    secrets.get("JIRA_URL"),
            "projects":    ", ".join(PROJECTS),
            "issue_types": SYNC_ISSUE_TYPES,
            "start_date":  SYNC_START_DATE,
        },
    }


@router.get("/api/logs")
def api_logs():
    return _list_logs()


@router.get("/api/transformations")
def api_transformations():
    import ast as _ast
    trans_dir = SYNC_DIR / "transformations"
    result = []
    for path in sorted(trans_dir.glob("*.py")):
        if path.stem.startswith("_"):
            continue
        try:
            source = path.read_text()
            tree = _ast.parse(source)
            docstring = _ast.get_docstring(tree) or ""
            lines = [l for l in docstring.strip().splitlines()]
            name = lines[0].strip() if lines else path.stem
            desc = ""
            for line in lines[2:]:
                stripped = line.strip()
                if stripped and not stripped.startswith("="):
                    desc = stripped
                    break
            output_rel = None
            for node in _ast.walk(tree):
                if isinstance(node, _ast.Assign):
                    for target in node.targets:
                        if isinstance(target, _ast.Name) and target.id == "OUTPUT":
                            if isinstance(node.value, _ast.Constant):
                                output_rel = node.value.value
            rows, updated_at = None, None
            if output_rel:
                out_path = DATA_DIR.parent / output_rel
                try:
                    mtime = datetime.fromtimestamp(out_path.stat().st_mtime, tz=timezone.utc).isoformat()
                    updated_at = mtime
                    if output_rel.endswith(".jsonl"):
                        rows = sum(1 for l in out_path.open() if l.strip())
                    else:
                        import csv as _csv
                        with open(out_path, newline="") as f:
                            rows = sum(1 for _ in _csv.reader(f)) - 1
                except Exception:
                    pass
            result.append({"id": path.stem, "name": name, "description": desc,
                           "output": output_rel, "rows": rows, "updated_at": updated_at})
        except Exception:
            continue
    return result


@router.get("/api/logs/{name}", response_class=PlainTextResponse)
def api_log_content(name: str):
    if not name.endswith(".log") or "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid log name")
    path = DATA_DIR / "logs" / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    return path.read_text()


@router.post("/api/sync")
def api_sync(background_tasks: BackgroundTasks, force: bool = False):
    with _sync_lock:
        if _sync_state["running"]:
            raise HTTPException(status_code=409, detail="Sync already running")
        _sync_state["running"]    = True
        _sync_state["started_at"] = datetime.now(timezone.utc).isoformat()
    background_tasks.add_task(_run_sync, force)
    return {"started": True}
