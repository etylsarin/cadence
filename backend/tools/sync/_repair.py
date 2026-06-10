#!/usr/bin/env python3
"""
_repair.py — Sync Repair.

Reverses false deletions: strips synthetic "_sync deleted" changelog entries
from bronze JSON files and resets their meta files back to deleted=false.

Usage:
  ./_repair.py          # dry run — shows what would be repaired
  ./_repair.py --apply  # apply the repairs
"""

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR   = SCRIPT_DIR.parent.parent / "data"
CACHE_DIR  = DATA_DIR / "bronze"


@dataclass
class RepairResult:
    """Structured outcome of a repair run."""
    fixed: int = 0
    dry_run: bool = True


def write_atomic(path: Path, text: str):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def has_synthetic(doc: dict) -> bool:
    return any((h.get("_sync") or {}).get("synthetic")
               for h in (doc.get("changelog") or {}).get("histories", []))


def run(apply: bool = False) -> RepairResult:
    """Reverse false deletions. Importable entry point; same output as the CLI."""
    dry_run = not apply

    fixed = 0
    for meta_file in sorted(CACHE_DIR.glob("*.meta")):
        key = meta_file.stem

        try:
            meta = json.loads(meta_file.read_text())
        except Exception:
            continue
        if not meta.get("deleted"):
            continue

        json_file = CACHE_DIR / f"{key}.json"
        doc = None
        synthetic = False
        if json_file.exists():
            try:
                doc = json.loads(json_file.read_text())
                synthetic = has_synthetic(doc)
            except Exception:
                doc = None

        print(f"{key}  (synthetic={'true' if synthetic else 'false'})")
        fixed += 1

        if dry_run:
            continue

        # Strip all synthetic entries from the changelog.
        if doc is not None and synthetic:
            doc["changelog"]["histories"] = [
                h for h in doc["changelog"]["histories"]
                if not (h.get("_sync") or {}).get("synthetic")
            ]
            write_atomic(json_file, json.dumps(doc))

        # Reset meta.
        meta["deleted"] = False
        meta["deleted_detected"] = None
        write_atomic(meta_file, json.dumps(meta))

    print()
    if dry_run:
        print(f"Dry run — {fixed} tickets would be repaired. Run with --apply to fix.")
    else:
        print(f"Repaired {fixed} tickets.")
    return RepairResult(fixed=fixed, dry_run=dry_run)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true",
                        help="apply the repairs (default is a dry run)")
    args = parser.parse_args()
    run(apply=args.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
