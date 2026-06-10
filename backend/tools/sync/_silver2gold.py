#!/usr/bin/env python3
"""
_silver2gold.py — Run all silver→gold transformations and write CSV outputs.

Each transformation lives in its own file under transformations/.
Every module there must expose:

    OUTPUT  str        relative path of the output CSV (from the project root)
    FIELDS  list[str]  CSV column names in order
    transform(issues: list) -> list[dict]

To add a new metric: create a new .py file in transformations/ following
the same pattern.  It will be discovered and run automatically.

Transformations are run in parallel (4 workers) for faster pipeline execution.

Usage:
  ./_silver2gold.py                         # run every transformation
  ./_silver2gold.py throughput              # run one by name (no .py)
  ./_silver2gold.py throughput escaped_defects
"""

import argparse
import csv
import importlib
import json
import sys
from pathlib import Path
from multiprocessing.pool import ThreadPool

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT  = SCRIPT_DIR.parent.parent
DATA_DIR   = REPO_ROOT / "data"
SILVER_DIR = DATA_DIR / "silver"
TRANS_DIR  = SCRIPT_DIR / "transformations"


# ── Silver loader ─────────────────────────────────────────────────────────────

def load_silver() -> list:
    files  = sorted(SILVER_DIR.glob("*.json"))
    issues = []
    errors = 0
    for f in files:
        try:
            with open(f) as fh:
                issues.append(json.load(fh))
        except Exception as e:
            print(f"WARN: {f.name}: {e}", file=sys.stderr)
            errors += 1
    print(f"loaded={len(issues)} errors={errors}")
    return issues


# ── Writers ───────────────────────────────────────────────────────────────────

def write_csv(path: Path, rows: list, fieldnames: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".csv.tmp")
    with open(tmp, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    tmp.rename(path)
    print(f"wrote={len(rows)} → {path.relative_to(REPO_ROOT)}")


def write_jsonl(path: Path, rows: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".jsonl.tmp")
    with open(tmp, "w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.rename(path)
    print(f"wrote={len(rows)} → {path.relative_to(REPO_ROOT)}")


# ── Transformation discovery ──────────────────────────────────────────────────

def discover_transformations() -> list:
    """Return sorted list of transformation module names (no .py, no _prefix)."""
    return sorted(
        p.stem for p in TRANS_DIR.glob("*.py")
        if not p.stem.startswith("_")
    )


def load_transformation(name: str):
    """Import and return a transformation module by name."""
    module = importlib.import_module(f"transformations.{name}")
    required = ["OUTPUT", "transform"]
    if not getattr(module, "OUTPUT", "").endswith(".jsonl"):
        required.append("FIELDS")
    for attr in required:
        if not hasattr(module, attr):
            raise AttributeError(f"transformations/{name}.py is missing '{attr}'")
    return module


# ── CLI ───────────────────────────────────────────────────────────────────────

# ── Parallel transformation runner ────────────────────────────────────────────

def run_transformation(args_tuple):
    """Run a single transformation (for use with ThreadPool).
    Returns (name, success: bool, message: str)
    """
    name, issues = args_tuple
    try:
        mod  = load_transformation(name)
        rows = mod.transform(issues)
        output_path = REPO_ROOT / mod.OUTPUT
        if mod.OUTPUT.endswith(".jsonl"):
            write_jsonl(output_path, rows)
        else:
            write_csv(output_path, rows, mod.FIELDS)
        return (name, True, "written")
    except Exception as e:
        return (name, False, f"ERROR: {e}")

# ── CLI ───────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("transformations", nargs="*", metavar="NAME",
                    help="transformation(s) to run (default: all)")
args = parser.parse_args()

names = args.transformations or discover_transformations()

if not names:
    print("No transformations found in transformations/", file=sys.stderr)
    sys.exit(1)

print("loading silver...")
issues = load_silver()

# Run transformations in parallel (4 workers)
print(f"running {len(names)} transformation(s) in parallel...")
with ThreadPool(4) as pool:
    # Prepare args: each transformation gets the shared issues list
    transformation_args = [(name, issues) for name in names]
    results = pool.map(run_transformation, transformation_args)

# Report results
errors = []
for name, success, message in results:
    if success:
        print(f"{name}: {message}")
    else:
        print(f"{name}: {message}", file=sys.stderr)
        errors.append(name)

if errors:
    print(f"\nFailed transformations: {', '.join(errors)}", file=sys.stderr)
    sys.exit(1)

print("Done.")
