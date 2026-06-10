#!/usr/bin/env python3
"""
_gettickets.py — Sync, Jira Mirror.

Downloads all matching Jira tickets to the local JSON cache (bronze), one file
per ticket. Tracks changes via per-ticket .meta files and marks deleted tickets
with a synthetic changelog entry rather than removing them.

Three phases:
  1. Discovery     — paginated JQL search returning key + updated only (fast).
  2. Download      — fetch full issue (?expand=changelog) for new/changed keys.
  3. Deletion scan — flag cached tickets Jira no longer returns as deleted.

Usage:
  ./_gettickets.py               # normal sync
  ./_gettickets.py --force       # re-download all tickets regardless of cache
  ./_gettickets.py --key PROJ-42 # force re-download a single ticket

Credentials and project scope come from config.env / .env (see config.py).
Uses only the Python standard library — no third-party HTTP client required.
"""

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
# Make backend/ importable so we can reuse the shared config parser.
sys.path.insert(0, str(SCRIPT_DIR.parent.parent))
from config import load_config, PROJECTS, SYNC_ISSUE_TYPES, SYNC_START_DATE  # noqa: E402

DATA_DIR  = SCRIPT_DIR.parent.parent / "data"
CACHE_DIR = DATA_DIR / "bronze"
LOGS_DIR  = DATA_DIR / "logs"

HTTP_TIMEOUT = 60  # seconds, per request


@dataclass
class SyncResult:
    """Structured outcome of a sync run — counts mirror the printed summary line."""
    discovered: int = 0
    new: int = 0
    updated: int = 0
    skipped: int = 0
    deleted: int = 0
    errors: int = 0
    api_calls: int = 0
    duration_s: int = 0


# ── Config ──────────────────────────────────────────────────────────────────

_secrets  = load_config()
JIRA_URL  = _secrets.get("JIRA_URL", "")
EMAIL     = _secrets.get("JIRA_EMAIL", "")
API_TOKEN = _secrets.get("API_TOKEN", "")


def _require_config():
    missing = []
    if not JIRA_URL:           missing.append("JIRA_URL")
    if not EMAIL:              missing.append("JIRA_EMAIL")
    if not API_TOKEN:          missing.append("JIRA_API_TOKEN")
    if not PROJECTS:           missing.append("PROJECTS")
    if not SYNC_ISSUE_TYPES:   missing.append("SYNC_ISSUE_TYPES")
    if not SYNC_START_DATE:    missing.append("SYNC_START_DATE")
    if missing:
        print(f"ERROR: missing config: {', '.join(missing)} "
              f"— add to .env / config.env or environment variables", file=sys.stderr)
        sys.exit(1)


# ── HTTP helpers (stdlib) ─────────────────────────────────────────────────────

def _auth_header() -> str:
    raw = f"{EMAIL}:{API_TOKEN}".encode()
    return "Basic " + base64.b64encode(raw).decode()


class JiraError(Exception):
    """Raised when the Jira API returns an error or is unreachable."""


def _request(url: str, *, method: str = "GET", body: dict | None = None) -> dict:
    headers = {"Accept": "application/json", "Authorization": _auth_header()}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        # Surface Jira's structured error messages when present.
        detail = ""
        try:
            payload = json.loads(e.read().decode())
            msgs = payload.get("errorMessages") or []
            detail = "; ".join(msgs) or json.dumps(payload.get("errors", {}))
        except Exception:
            detail = e.reason or str(e)
        raise JiraError(f"HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise JiraError(str(e)) from e


def jira_get(url: str) -> dict:
    return _request(url)


def jira_post(url: str, body: dict) -> dict:
    return _request(url, method="POST", body=body)


# ── Logging ───────────────────────────────────────────────────────────────────

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
# Log filename uses dashes instead of colons so it's safe on all filesystems.
LOG_FILE = LOGS_DIR / f"{NOW.replace(':', '-')}.log"


def log(msg: str):
    """Write a timestamped line to the per-sync log file only (not the terminal)."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(LOG_FILE, "a") as f:
        f.write(f"{ts}  {msg}\n")


# ── Misc helpers ────────────────────────────────────────────────────────────

def format_duration(secs: int) -> str:
    if secs < 60:
        return f"{secs}s"
    if secs < 3600:
        return f"{secs // 60}m{secs % 60:02d}s"
    return f"{secs // 3600}h{(secs % 3600) // 60:02d}m"


_progress_last_t = 0.0


def progress(msg: str):
    """Throttled progress: print to stdout at most once every 2 seconds."""
    global _progress_last_t
    t = time.monotonic()
    if t - _progress_last_t >= 2:
        print(msg)
        _progress_last_t = t


def write_atomic(path: Path, text: str):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def write_meta(path: Path, jira_updated: str, *, deleted: bool = False,
               deleted_detected: str | None = None):
    write_atomic(path, json.dumps({
        "jira_updated":     jira_updated,
        "last_synced":      NOW,
        "deleted":          deleted,
        "deleted_detected": deleted_detected,
    }))


def last_status(doc: dict) -> str:
    """Return the most recent status the issue transitioned to, or 'Unknown'."""
    statuses = [
        item.get("toString")
        for h in (doc.get("changelog") or {}).get("histories", [])
        for item in h.get("items", [])
        if item.get("field") == "status"
    ]
    return statuses[-1] if statuses else "Unknown"


# ── Single-ticket mode (--key) ────────────────────────────────────────────────

def run_single(key: str) -> SyncResult:
    print(f"fetching single ticket: {key}")
    log(f"START  mode=--key  key={key}")

    try:
        issue = jira_get(f"{JIRA_URL}/rest/api/3/issue/{key}?expand=changelog")
    except JiraError as e:
        log(f"ERROR  {key}  download failed")
        print(f"[ERROR] Download failed: {key} ({e})", file=sys.stderr)
        return SyncResult(errors=1, api_calls=1)

    jira_updated = (issue.get("fields") or {}).get("updated", "") or ""
    write_atomic(CACHE_DIR / f"{key}.json", json.dumps(issue))
    write_meta(CACHE_DIR / f"{key}.meta", jira_updated)

    log(f"FORCE  {key}")
    log(f"DONE   mode=--key  key={key}")
    print(f"done: {key} saved")
    return SyncResult(new=1, api_calls=1)


# ── Phase 1: Discovery ────────────────────────────────────────────────────────

def discover() -> tuple[list[tuple[str, str]], int]:
    """Return (list of (key, updated), page_count)."""
    jql = (f'project in ({",".join(PROJECTS)}) '
           f'AND issuetype in ({SYNC_ISSUE_TYPES}) '
           f'AND created >= "{SYNC_START_DATE}" ORDER BY created ASC')

    discovered: list[tuple[str, str]] = []
    page_token = ""
    pages = 0

    progress("Discovering...")
    while True:
        body: dict = {"jql": jql, "maxResults": 100, "fields": ["updated"]}
        if page_token:
            body["nextPageToken"] = page_token

        try:
            resp = jira_post(f"{JIRA_URL}/rest/api/3/search/jql", body)
        except JiraError as e:
            print(f"ERROR: Jira API: {e}", file=sys.stderr)
            sys.exit(1)

        if resp.get("errorMessages"):
            print(f"ERROR: Jira API: {'; '.join(resp['errorMessages'])}", file=sys.stderr)
            sys.exit(1)

        for issue in resp.get("issues", []):
            discovered.append((issue.get("key", ""),
                               (issue.get("fields") or {}).get("updated", "") or ""))
        pages += 1
        progress(f"Discovering... {len(discovered)}")

        page_token = resp.get("nextPageToken") or ""
        if not page_token:
            break

    return discovered, pages


# ── Phase 2: Download / Update ────────────────────────────────────────────────

def decide_action(key: str, jira_updated: str, force: bool) -> str | None:
    """Return 'force' | 'new' | 'updated' | None (skip)."""
    meta_file = CACHE_DIR / f"{key}.meta"
    if force:
        return "force"
    if not meta_file.exists():
        return "new"
    try:
        stored = json.loads(meta_file.read_text()).get("jira_updated", "")
    except Exception:
        stored = ""
    return "updated" if stored != jira_updated else None


def download_phase(discovered: list[tuple[str, str]], force: bool) -> dict:
    total = len(discovered)
    counts = {"new": 0, "updated": 0, "skipped": 0, "error": 0}
    proc_start = time.monotonic()

    for processed, (key, jira_updated) in enumerate(discovered, 1):
        if not key:
            continue
        remaining = total - processed

        action = decide_action(key, jira_updated, force)

        # ── ETA & rate ──────────────────────────────────────────────────────
        elapsed = time.monotonic() - proc_start
        if processed > 1 and elapsed > 0:
            eta_str = format_duration(int(elapsed * remaining / processed))
            avg10 = int(elapsed * 10 / processed)
            rate_str = f"{avg10 // 10}.{avg10 % 10}s/t"
        else:
            eta_str, rate_str = "...", "--"

        progress(f"{processed}/{total}  eta={eta_str}  rate={rate_str}  "
                 f"new={counts['new']} updated={counts['updated']} skipped={counts['skipped']}")

        if action is None:
            counts["skipped"] += 1
            continue

        try:
            issue = jira_get(f"{JIRA_URL}/rest/api/3/issue/{key}?expand=changelog")
        except JiraError as e:
            print(f"[ERROR] Download failed: {key} ({e})", file=sys.stderr)
            log(f"ERROR  {key}  download failed")
            counts["error"] += 1
            continue

        write_atomic(CACHE_DIR / f"{key}.json", json.dumps(issue))
        write_meta(CACHE_DIR / f"{key}.meta", jira_updated)

        if action in ("new", "force"):
            counts["new"] += 1
            log(f"NEW     {key}")
        else:
            counts["updated"] += 1
            log(f"UPDATED {key}")

    return counts


# ── Phase 3: Deletion detection ───────────────────────────────────────────────

def deletion_phase(discovered: list[tuple[str, str]]) -> list[str]:
    print("checking deletions...")
    discovered_keys = {k for k, _ in discovered}
    projects_norm = {p.upper() for p in PROJECTS}
    deleted_keys: list[str] = []

    for meta_file in sorted(CACHE_DIR.glob("*.meta")):
        key = meta_file.stem
        if key in discovered_keys:
            continue

        try:
            meta = json.loads(meta_file.read_text())
        except Exception:
            continue
        if meta.get("deleted"):
            continue

        # ── Scope checks: only flag tickets the current query should return ──
        project = key.split("-", 1)[0]
        if project.upper() not in projects_norm:
            continue

        json_file = CACHE_DIR / f"{key}.json"
        doc = None
        if json_file.exists():
            try:
                doc = json.loads(json_file.read_text())
            except Exception:
                doc = None
        if doc is not None:
            created = (doc.get("fields") or {}).get("created", "")[:10]
            if created and created < SYNC_START_DATE:
                continue

        # ── Genuinely gone from Jira → mark deleted ──────────────────────────
        deleted_keys.append(key)

        if doc is not None:
            changelog = doc.setdefault("changelog", {})
            changelog.setdefault("histories", []).append({
                "_sync": {"synthetic": True, "event": "deleted"},
                "id":      "_sync_deleted",
                "created": NOW,
                "items": [{
                    "field":      "status",
                    "fieldtype":  "jira",
                    "fromString": last_status(doc),
                    "toString":   "Deleted",
                }],
            })
            write_atomic(json_file, json.dumps(doc))

        write_meta(meta_file, meta.get("jira_updated", ""),
                   deleted=True, deleted_detected=NOW)
        log(f"DELETED {key}")

    return deleted_keys


# ── Orchestration ─────────────────────────────────────────────────────────

def run(force: bool = False, key: str | None = None) -> SyncResult:
    """Run a full sync (or a single-ticket fetch) and return a structured result.

    Importable entry point. Produces the same stdout/log output as the CLI.
    NOW/LOG_FILE are (re)stamped here so repeated in-process calls each get
    their own per-sync log file.
    """
    global NOW, LOG_FILE
    NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    LOG_FILE = LOGS_DIR / f"{NOW.replace(':', '-')}.log"

    _require_config()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    mode_suffix = " mode=force" if force else ""
    print(f"started={NOW} projects={','.join(PROJECTS)} "
          f"types={SYNC_ISSUE_TYPES} since={SYNC_START_DATE}{mode_suffix}")
    log(f"START  projects={','.join(PROJECTS)}  types={SYNC_ISSUE_TYPES}  "
        f"since={SYNC_START_DATE}{mode_suffix}")

    if key:
        return run_single(key)

    # ── Phase 1: discovery ───────────────────────────────────────────────────
    discovered, pages = discover()
    print(f"discovered={len(discovered)}")
    log(f"DISCOVER  {len(discovered)} tickets")

    if not discovered:
        log("DONE  nothing to do")
        print("nothing to do")
        return SyncResult(api_calls=pages)

    proc_start = time.monotonic()

    # ── Phase 2: download ────────────────────────────────────────────────────
    counts = download_phase(discovered, force)

    # ── Phase 3: deletion detection ──────────────────────────────────────────
    deleted_keys = deletion_phase(discovered)
    if deleted_keys:
        print(f"deleted={len(deleted_keys)} keys={' '.join(deleted_keys)}")

    # ── Summary ──────────────────────────────────────────────────────────────
    duration_s = int(time.monotonic() - proc_start)
    elapsed_str = format_duration(duration_s)
    api_calls = pages + counts["new"] + counts["updated"] + counts["error"]
    summary = (f"new={counts['new']} updated={counts['updated']} "
               f"skipped={counts['skipped']} deleted={len(deleted_keys)} "
               f"errors={counts['error']} api_calls={api_calls} time={elapsed_str}")
    print(summary)
    log(f"SUMMARY  new={counts['new']}  updated={counts['updated']}  "
        f"skipped={counts['skipped']}  deleted={len(deleted_keys)}  "
        f"errors={counts['error']}  api_calls={api_calls}  time={elapsed_str}")
    log("DONE")

    (DATA_DIR / "last_sync.txt").write_text(NOW)
    print("done")

    return SyncResult(
        discovered=len(discovered),
        new=counts["new"], updated=counts["updated"], skipped=counts["skipped"],
        deleted=len(deleted_keys), errors=counts["error"],
        api_calls=api_calls, duration_s=duration_s,
    )


# ── CLI ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true",
                        help="re-download all tickets regardless of cache state")
    parser.add_argument("--key", metavar="KEY",
                        help="force re-download a single ticket (e.g. PROJ-42)")
    args = parser.parse_args()
    result = run(force=args.force, key=args.key)
    return 0 if result.errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
