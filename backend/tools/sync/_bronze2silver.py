#!/usr/bin/env python3
"""
_bronze2silver.py — Transform bronze → silver Jira JSON files.

Transformations applied:
  - Strip .self from all objects (recursive)
  - Strip .iconUrl from all objects (recursive)
  - Strip .avatarUrls / .avatarId from all objects (recursive)
  - Strip user noise: .accountType, .timeZone, .active from person objects
    (assignee, reporter, creator, changelog authors)
  - Remove known bulk workflow-migration changelog entries (see BULK_MIGRATIONS)

Empty/null fields are kept as-is.

Usage:
  ./_bronze2silver.py              # process all, skip already up-to-date
  ./_bronze2silver.py --force      # reprocess everything
  ./_bronze2silver.py --key PROJ-42
"""

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DATA_DIR   = SCRIPT_DIR.parent.parent / "data"
BRONZE_DIR = DATA_DIR / "bronze"
SILVER_DIR = DATA_DIR / "silver"

# Keys stripped from every object in the document
STRIP_EVERYWHERE = {"self", "iconUrl", "avatarUrls", "avatarId"}

# Keys stripped only from person/user objects
STRIP_FROM_USERS = {"accountType", "timeZone", "active"}

# ── Bulk workflow-migration sanitization ──────────────────────────────────────
#
# When a Jira admin bulk-moves completed tickets between statuses as part of a
# workflow rollout, those changelog entries are NOT organic work events — they
# are infrastructure changes applied retroactively and corrupt flow-metrics
# time-in-status and throughput calculations.
#
# Removing them here keeps the silver layer clean for all downstream consumers.
# The raw bronze files are always preserved as the source of truth.
#
# To register a migration: append a tuple
#   (project, "YYYY-MM-DD", from_status, to_status, admin_account_id).
# The author check acts as a second guard against accidental removal of any
# legitimate same-day user transition.

BULK_MIGRATIONS: list[tuple[str, str, str, str, str]] = []

# Fast lookup: (project, YYYY-MM-DD, from_status, to_status, author_account_id)
_BULK_SIG = frozenset(BULK_MIGRATIONS)

# Accumulated per-run sanitization counts: (project, date, from, to) → n entries removed
_SANIT_COUNTS: Counter = Counter()


def strip_bulk_migrations(doc: dict) -> dict:
    """
    Remove bulk-migration changelog entries from a cleaned silver document.

    A history entry is dropped when ALL of these hold:
      • its date matches a known migration date for the issue's project
      • the status transition (from → to) matches the configured pattern
      • the author is the known admin accountId (double-check against accidents)

    The changelog total/maxResults counters are updated to stay consistent.
    """
    project = (doc.get("fields") or {}).get("project") or {}
    project_key = project.get("key", "") if isinstance(project, dict) else ""

    changelog = doc.get("changelog")
    if not changelog or not project_key:
        return doc

    histories = changelog.get("histories", [])
    cleaned = []
    for h in histories:
        date = h.get("created", "")[:10]          # "YYYY-MM-DD"
        author_id = (h.get("author") or {}).get("accountId", "")
        keep = True
        for item in h.get("items", []):
            if item.get("field") == "status":
                sig = (project_key, date,
                       item.get("fromString", ""),
                       item.get("toString", ""),
                       author_id)
                if sig in _BULK_SIG:
                    keep = False
                    _SANIT_COUNTS[(project_key, date,
                                   item.get("fromString", ""),
                                   item.get("toString", ""))] += 1
                    break
        if keep:
            cleaned.append(h)

    if len(cleaned) == len(histories):
        return doc   # nothing removed — return unchanged to avoid a copy

    new_changelog = dict(changelog)
    new_changelog["histories"] = cleaned
    new_changelog["total"] = len(cleaned)
    new_changelog["maxResults"] = len(cleaned)

    new_doc = dict(doc)
    new_doc["changelog"] = new_changelog
    return new_doc


# ── Field cleaning ────────────────────────────────────────────────────────────

# A person object is identified by having accountId
def is_person(obj: dict) -> bool:
    return "accountId" in obj


def clean(obj):
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            if k in STRIP_EVERYWHERE:
                continue
            if is_person(obj) and k in STRIP_FROM_USERS:
                continue
            result[k] = clean(v)
        return result
    if isinstance(obj, list):
        return [clean(item) for item in obj]
    return obj


def process_file(bronze_path: Path, silver_path: Path) -> str:
    """Returns 'written', 'skipped', or 'error:<msg>'."""
    try:
        bronze_mtime = bronze_path.stat().st_mtime
        if silver_path.exists() and silver_path.stat().st_mtime >= bronze_mtime:
            return "skipped"

        with open(bronze_path) as f:
            doc = json.load(f)

        cleaned = strip_bulk_migrations(clean(doc))

        silver_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = silver_path.with_suffix(".json.tmp")
        with open(tmp, "w") as f:
            json.dump(cleaned, f, separators=(",", ":"))
        tmp.rename(silver_path)
        return "written"
    except Exception as e:
        return f"error:{e}"


# ── CLI ───────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--force", action="store_true", help="reprocess all files even if silver is newer")
parser.add_argument("--key", metavar="KEY", help="process a single ticket key (e.g. PROJ-42)")
args = parser.parse_args()

def _print_sanit_summary():
    if _SANIT_COUNTS:
        total_removed = sum(_SANIT_COUNTS.values())
        print(f"sanitization: removed {total_removed} bulk-migration entries")
        for (proj, date, frm, to), n in sorted(_SANIT_COUNTS.items()):
            print(f"  {proj} {date}  {frm} → {to}: {n} entries")
    else:
        print("sanitization: no bulk-migration entries removed")


# ── Single-key mode ───────────────────────────────────────────────────────────
if args.key:
    bp = BRONZE_DIR / f"{args.key}.json"
    sp = SILVER_DIR / f"{args.key}.json"
    if not bp.exists():
        print(f"ERROR: {bp} not found", file=sys.stderr)
        sys.exit(1)
    if not args.force:
        # force single-key to always write
        sp.unlink(missing_ok=True)
    result = process_file(bp, sp)
    print(f"{args.key}: {result}")
    _print_sanit_summary()
    sys.exit(0 if not result.startswith("error") else 1)

# ── Batch mode ────────────────────────────────────────────────────────────────
files = sorted(BRONZE_DIR.glob("*.json"))
total = len(files)
written = skipped = errors = 0

for i, bp in enumerate(files, 1):
    sp = SILVER_DIR / bp.name
    if args.force:
        sp.unlink(missing_ok=True)
    result = process_file(bp, sp)
    if result == "written":
        written += 1
    elif result == "skipped":
        skipped += 1
    else:
        errors += 1
        print(f"ERROR {bp.name}: {result[6:]}", file=sys.stderr)

    if i % 200 == 0 or i == total:
        print(f"{i}/{total} written={written} skipped={skipped} errors={errors}")

print(f"done written={written} skipped={skipped} errors={errors}")
_print_sanit_summary()
sys.exit(0 if errors == 0 else 1)
