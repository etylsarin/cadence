"""
Flow Metrics
============
Per-issue time spent in each status, enabling lead time, cycle time, and flow
efficiency analysis.

Which issues are included?
--------------------------
Only **Story** and **Bug** issue types are included.  Tasks, Spikes, and other
types are excluded because flow efficiency is meaningful for work items that go
through the full dev-to-release workflow.

An issue is included when at least one of its status transitions lands on a
terminal state: Closed, Done, Rejected, or Delivered.

query = the YYYY-MM month of the issue's *first* terminal status transition.
Each issue appears exactly once (at its first completion month), so re-opened
and re-closed issues are not double-counted.

Time in status
--------------
For every Jira status an issue passed through we calculate the elapsed time
(in days, 3 decimal places) and accumulate it across all visits — because
an issue can be sent back to a status it has already been in (rework loops).

    Initial status  — the "from" of the first changelog transition.
                      Elapsed time = first transition timestamp − issue
                      creation timestamp.

    Intermediate    — the status entered at each transition.
                      Elapsed time = next transition timestamp − current
                      transition timestamp.

    Final status    — always 0.0.  The clock stops when the issue first
                      reaches a terminal state; no open-ended accumulation.

All arithmetic uses UTC-normalised timestamps (timezone offsets are applied
before subtraction), so a daylight-saving clock change within an interval does
not inflate or deflate the result by one hour.

Empty cell  = the issue never visited that status.
0.0         = visited but stayed for an immeasurably short time (< 0.0005 d),
              OR it is the final terminal status.

Status columns
--------------
One column is emitted for every status key in flow_config.json (project root),
sorted alphabetically.  flow_config.json also maps each status to a workflow
stage (pre_work, dev, wait_testing, testing, uat, sit, wait_release,
post_work) for higher-level stage-level aggregation in downstream tools.

If a status is encountered in the data that is not yet in flow_config.json it is
added automatically with an empty stage value ("" = unassigned), flow_config.json
is updated atomically, and the new column appears in the CSV output.  In the
Cadence FlowMetrics app unassigned statuses are silently excluded from stage
aggregation until they are manually assigned a stage via the UI.

Other columns
-------------
Steps / transitions_steps   Number of status transitions recorded in the
                             changelog.  Both columns carry the same value for
                             compatibility with the original output format.
Path                         Human-readable state sequence:
                             "Open -> In Progress -> Code Review -> Done"
                             Repeated states appear multiple times when the
                             issue was sent back through them.
"""

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from transformations._lib import (
    TERMINAL_STATUSES,
    first_terminal,
    format_local,
    format_transitions,
    parse_dt,
    status_transitions,
)

# ── Status config ─────────────────────────────────────────────────────────────

_CONFIG_PATH = Path(__file__).parent.parent / "data" / "gold" / "flow_config.json"
_DEFAULT_PATH = Path(__file__).parent.parent / "flow_config_default.json"


def _load_status_config() -> dict:
    """Load user config, falling back to the shared default so new syncs don't wipe assignments."""
    if _CONFIG_PATH.exists():
        with open(_CONFIG_PATH) as _f:
            return json.load(_f)
    # No user config yet — seed from the default so mappings are preserved
    if _DEFAULT_PATH.exists():
        with open(_DEFAULT_PATH) as _f:
            return json.load(_f)
    return {}


_STATUS_CONFIG = _load_status_config()

STATUS_COLUMNS = sorted(_STATUS_CONFIG.keys())

OUTPUT = "data/gold/flow_metrics.csv"
_BASE_FIELDS = [
    "query",
    "issue",
    "project",
    "type",
    "story_points",
    "priority",
    "current_status",
    "created",
    "Steps",
    "Path",
    "transitions_steps",
    "transitions",
]
FIELDS = _BASE_FIELDS + STATUS_COLUMNS


FLOW_ISSUE_TYPES = {"Story", "Bug"}

# ── Core calculation ──────────────────────────────────────────────────────────


def _time_in_status(created_iso: str, transitions: list) -> dict:
    """
    Return {status_name: elapsed_days} for every status the issue visited.

    Uses UTC-aware timestamps so that daylight-saving transitions do not skew
    the result (see module docstring).  The final terminal status is always
    recorded as 0.0.  Negative durations (out-of-order changelog entries) are
    clamped to 0.0.
    """
    if not transitions:
        return {}

    times = defaultdict(float)

    # ── Initial status: from issue creation to first recorded transition ──────
    initial_status = transitions[0]["from"]
    t_created = parse_dt(created_iso)
    t_first = parse_dt(transitions[0]["created"])
    if t_created and t_first:
        delta = (t_first - t_created).total_seconds() / 86400
        times[initial_status] += max(delta, 0.0)  # clamp negatives

    # ── Intermediate statuses: between consecutive transitions ────────────────
    for i in range(len(transitions) - 1):
        status = transitions[i]["to"]
        t_enter = parse_dt(transitions[i]["created"])
        t_exit = parse_dt(transitions[i + 1]["created"])
        if t_enter and t_exit:
            delta = (t_exit - t_enter).total_seconds() / 86400
            times[status] += max(delta, 0.0)

    # ── Final status: open-ended — time from last transition to now ──────────
    # Consistent with Jira's own "Time In Status" display which also shows an
    # ever-growing duration for the current status.  The value is captured at
    # pipeline-run time so it is stable within a single CSV snapshot.
    final_status = transitions[-1]["to"]
    t_last = parse_dt(transitions[-1]["created"])
    if t_last:
        now = datetime.now(timezone.utc)
        delta = (now - t_last).total_seconds() / 86400
        times[final_status] += max(delta, 0.0)
    elif final_status not in times:
        times[final_status] = 0.0

    return dict(times)


def _fmt_time(days: float) -> str:
    """Format a duration as str(round(x, 3)), giving '0.0' not '0.000'."""
    return str(round(days, 3))


# ── Transformation ────────────────────────────────────────────────────────────


def transform(issues: list) -> list:
    # ── Discover statuses not yet in flow_config.json ─────────────────────────
    seen: set = set()
    for issue in issues:
        for t in status_transitions(issue):
            if t["from"]:
                seen.add(t["from"])
            if t["to"]:
                seen.add(t["to"])

    new_statuses = sorted(seen - set(_STATUS_CONFIG.keys()))
    if new_statuses:
        for s in new_statuses:
            _STATUS_CONFIG[s] = ""  # "" = unassigned in Cadence
        STATUS_COLUMNS[:] = sorted(_STATUS_CONFIG.keys())
        FIELDS[:] = _BASE_FIELDS + STATUS_COLUMNS
        tmp = _CONFIG_PATH.with_suffix(".json.tmp")
        with open(tmp, "w") as _f:
            json.dump(_STATUS_CONFIG, _f, indent=2, sort_keys=True)
        tmp.rename(_CONFIG_PATH)
        print(
            f"  flow_config.json: added {len(new_statuses)} new status(es): {', '.join(new_statuses)}"
        )

    rows = []

    for issue in issues:
        fields = issue.get("fields", {})
        issue_type = (fields.get("issuetype") or {}).get("name", "")

        if issue_type not in FLOW_ISSUE_TYPES:
            continue  # only Story and Bug contribute to flow metrics

        transitions = status_transitions(issue)
        terminal_t = first_terminal(transitions)

        if not terminal_t:
            continue  # issue never reached a terminal status

        terminal_dt = parse_dt(terminal_t["created"])
        if not terminal_dt:
            continue

        query = terminal_dt.strftime("%Y-%m")
        created_iso = fields.get("created", "")
        time_map = _time_in_status(created_iso, transitions)

        # Path: initial state followed by every "to" state in order
        path = (
            " -> ".join([transitions[0]["from"]] + [t["to"] for t in transitions])
            if transitions
            else ""
        )

        trans_str, trans_count = format_transitions(transitions)

        sp = fields.get("customfield_10005")
        priority = fields.get("priority")

        row = {
            "query": query,
            "issue": issue.get("key", ""),
            "project": (fields.get("project") or {}).get("key", ""),
            "type": (fields.get("issuetype") or {}).get("name", ""),
            "story_points": f"{float(sp):.1f}" if sp is not None else "",
            "priority": priority.get("name", "") if isinstance(priority, dict) else "",
            "current_status": (fields.get("status") or {}).get("name", ""),
            "created": format_local(created_iso),
            "Steps": trans_count,
            "Path": path,
            "transitions_steps": trans_count,
            "transitions": trans_str,
        }

        for status in STATUS_COLUMNS:
            row[status] = _fmt_time(time_map[status]) if status in time_map else ""

        rows.append(row)

    rows.sort(key=lambda r: (r["query"], r["issue"]))
    return rows
