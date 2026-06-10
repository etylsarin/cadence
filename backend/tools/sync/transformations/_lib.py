"""
Shared helpers used by all silver→gold transformations.
"""

import re
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Optional

TERMINAL_STATUSES = {"Closed", "Done", "Rejected", "Delivered"}
FLOW_DLT_GROUPS = {"dev", "wait_testing", "testing", "wait_sit", "sit", "wait_uat", "uat", "wait_release"}

# Live override in the shared data layer (same path flow_shared.py reads);
# falls back to the default mapping shipped with the pipeline.
_FLOW_CONFIG_PATH  = Path(__file__).parents[3] / "data" / "gold" / "flow_config.json"
_FLOW_DEFAULT_PATH = Path(__file__).parent.parent / "flow_config_default.json"


# ── Datetime ──────────────────────────────────────────────────────────────────

def parse_dt(iso_str: str) -> Optional[datetime]:
    """Parse ISO 8601 string (with timezone offset) to UTC-aware datetime."""
    if not iso_str:
        return None
    s = iso_str.strip()
    s = re.sub(r'([+-])(\d{2})(\d{2})$', r'\1\2:\3', s)   # -0500 → -05:00
    s = re.sub(r'(\.\d{6})\d+', r'\1', s)                  # trim >6 fractional digits
    try:
        return datetime.fromisoformat(s).astimezone(timezone.utc)
    except ValueError:
        return None


def format_local(iso_str: str) -> str:
    """Format ISO 8601 as 'YYYY-MM-DD HH:MM:SS' — local time, no timezone, no millis."""
    if not iso_str:
        return ""
    s = iso_str.strip()
    s = re.sub(r'[+-]\d{2}:?\d{2}$', '', s)   # strip tz offset
    s = re.sub(r'\.\d+$', '', s)               # strip milliseconds
    return s.replace('T', ' ')


# ── Custom field values ───────────────────────────────────────────────────────

def field_value(field) -> str:
    """
    Extract a readable string from any Jira custom field shape:
      None → ""
      "string" → "string"
      {"value": "x"} or {"name": "x"} → "x"
      [{"value": "x"}, {"value": "y"}] → "x; y"
    """
    if field is None:
        return ""
    if isinstance(field, str):
        return field
    if isinstance(field, (int, float)):
        return str(field)
    if isinstance(field, dict):
        return field.get("value") or field.get("name") or ""
    if isinstance(field, list):
        return "; ".join(field_value(item) for item in field if field_value(item))
    return ""


# ── Changelog / status transitions ───────────────────────────────────────────

def status_transitions(issue: dict) -> list:
    """
    Return all status-field changes from an issue's changelog, sorted oldest-first.
    Each entry is a dict: {"from": str, "to": str, "created": iso_str}
    """
    transitions = []
    for h in issue.get("changelog", {}).get("histories", []):
        for item in h.get("items", []):
            if item.get("field") == "status":
                transitions.append({
                    "from": item.get("fromString") or "",
                    "to":   item.get("toString")   or "",
                    "created": h["created"],
                })
    transitions.sort(key=lambda x: x["created"])
    return transitions


def first_terminal(transitions: list) -> Optional[dict]:
    """Return the first transition that lands in a terminal status, or None."""
    for t in transitions:
        if t["to"] in TERMINAL_STATUSES:
            return t
    return None


def format_transitions(transitions: list) -> tuple:
    """Return (semicolon-joined 'From->To@timestamp' string, count)."""
    parts = [f"{t['from']}->{t['to']}@{format_local(t['created'])}" for t in transitions]
    return ";".join(parts), len(parts)


def time_to_fix_days(created_iso: str, terminal_t: Optional[dict]) -> Optional[float]:
    """
    Days from issue creation to first terminal status transition, computed in UTC
    so that daylight-saving shifts don't affect the result.
    Returns None if the issue has not yet reached a terminal status.
    """
    if not terminal_t:
        return None
    created  = parse_dt(created_iso)
    terminal = parse_dt(terminal_t["created"])
    if not created or not terminal:
        return None
    return round((terminal - created).total_seconds() / 86400, 2)


def load_flow_status_map() -> dict:
    """Load the effective flow-status mapping used by Flow Metrics."""
    if _FLOW_CONFIG_PATH.exists():
        with open(_FLOW_CONFIG_PATH) as f:
            return json.load(f)
    if _FLOW_DEFAULT_PATH.exists():
        with open(_FLOW_DEFAULT_PATH) as f:
            return json.load(f)
    return {}


def time_in_status_until_first_terminal(created_iso: str, transitions: list) -> dict[str, float]:
    """
    Return {status_name: elapsed_days} from creation until the first terminal transition.

    This mirrors Flow Metrics' status-time accounting, but truncates at the first
    terminal transition so reopened work after first completion is excluded.
    """
    if not transitions:
        return {}

    terminal_idx = next((i for i, t in enumerate(transitions) if t["to"] in TERMINAL_STATUSES), None)
    if terminal_idx is None:
        return {}

    scoped = transitions[:terminal_idx + 1]
    times: dict[str, float] = {}

    initial_status = scoped[0]["from"]
    t_created = parse_dt(created_iso)
    t_first   = parse_dt(scoped[0]["created"])
    if initial_status and t_created and t_first:
        times[initial_status] = max((t_first - t_created).total_seconds() / 86400, 0.0)

    for i in range(len(scoped) - 1):
        status  = scoped[i]["to"]
        t_enter = parse_dt(scoped[i]["created"])
        t_exit  = parse_dt(scoped[i + 1]["created"])
        if not status or not t_enter or not t_exit:
            continue
        times[status] = times.get(status, 0.0) + max((t_exit - t_enter).total_seconds() / 86400, 0.0)

    final_status = scoped[-1]["to"]
    if final_status and final_status not in times:
        times[final_status] = 0.0

    return times


def dlt_days(created_iso: str, transitions: list, status_map: dict) -> Optional[float]:
    """
    Delivery Lead Time using the same status-group criteria as Flow Metrics.

    Only statuses mapped to the DLT groups (work + idle) are counted; pre/post
    work and unassigned statuses are excluded.
    """
    times = time_in_status_until_first_terminal(created_iso, transitions)
    if not times:
        return None
    total = sum(days for status, days in times.items() if status_map.get(status) in FLOW_DLT_GROUPS)
    return round(total, 1)
