"""Shared flow helpers: timeframe resolution and the status→stage map.

Owned by the Flow Metrics tool; the planner's throughput endpoint also
imports from here (both consume the Sync gold files and the flow
status→stage map). The default mapping ships with the pipeline at
tools/sync/flow_config_default.json.
"""

import csv
import json
import os

_DATA_DIR = os.path.join(os.path.dirname(__file__), "../../data/gold")

FLOW_CONFIG_PATH         = os.path.join(_DATA_DIR, "flow_config.json")
FLOW_CONFIG_DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "../sync/flow_config_default.json")

MONTH_MAP = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
}
ALL_MONTHS     = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
QUARTER_MONTHS = {
    'Q1': ['01', '02', '03'],
    'Q2': ['04', '05', '06'],
    'Q3': ['07', '08', '09'],
    'Q4': ['10', '11', '12'],
}


def get_months(gran: str, years: list, periods: list) -> set:
    """Resolve a gran/years/periods selection into a set of 'YYYY-MM' strings.

    Unknown period values (anything outside Q1–Q4 / Jan–Dec) are skipped, so a
    malformed query string narrows the selection instead of raising KeyError."""
    result = set()
    for y in years:
        if gran == 'Y':
            for m in ALL_MONTHS:
                result.add(f"{y}-{m}")
        elif gran == 'Q':
            for p in periods:
                for m in QUARTER_MONTHS.get(p, []):
                    result.add(f"{y}-{m}")
        else:
            for p in periods:
                m = MONTH_MAP.get(p)
                if m:
                    result.add(f"{y}-{m}")
    return result


def _read_flow_status_cols() -> list:
    """Read status column names from the flow_metrics.csv header (after 'transitions')."""
    csv_path = os.path.join(_DATA_DIR, 'flow_metrics.csv')
    try:
        with open(csv_path, newline='', encoding='utf-8') as f:
            headers = next(csv.reader(f))
        idx = headers.index('transitions')
        return headers[idx + 1:]
    except Exception:
        return []


# Cached by CSV mtime — refreshes when a sync rewrites the gold file, and
# starts working without a restart on a cold instance synced after startup.
_status_cols_cache = (None, [])


def all_status_cols() -> list:
    global _status_cols_cache
    csv_path = os.path.join(_DATA_DIR, 'flow_metrics.csv')
    try:
        mtime = os.stat(csv_path).st_mtime_ns
    except OSError:
        mtime = 0
    if _status_cols_cache[0] != mtime:
        _status_cols_cache = (mtime, _read_flow_status_cols())
    return _status_cols_cache[1]


def load_flow_default() -> dict:
    if os.path.exists(FLOW_CONFIG_DEFAULT_PATH):
        with open(FLOW_CONFIG_DEFAULT_PATH) as f:
            return json.load(f)
    return {}


def load_flow_config() -> dict:
    """Effective status→stage map: user-saved config, else the shipped default."""
    if os.path.exists(FLOW_CONFIG_PATH):
        with open(FLOW_CONFIG_PATH) as f:
            saved = json.load(f)
    else:
        saved = load_flow_default()
    return {col: saved.get(col, '') for col in all_status_cols()}
