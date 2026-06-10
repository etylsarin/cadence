"""
Escaped Defects
===============
Which production bugs were raised, and how long did they take to fix?

An "escaped defect" is a Bug that reached production before it was caught.
We identify them by two Jira custom fields (either condition is enough):

  • Environment(s) [customfield_12589] contains "Production [PROD]"
  • Discovered in Phase [customfield_12017] equals "Production"

Each bug is placed in the calendar month it was *created* (not resolved),
so the query column answers "which bugs were raised in this month?"

time_to_fix_days is the elapsed time from the bug's creation timestamp to
the moment its status first changed to a terminal state (Closed, Done,
Rejected, or Delivered).  The calculation uses UTC-normalised timestamps so
that daylight-saving transitions do not inflate or deflate the result.
The field is blank for bugs that have not yet reached a terminal status.

Columns
-------
query               YYYY-MM the bug was created
issue               Jira issue key
project             Jira project key
type                Always "Bug"
story_points        Story-point estimate (blank when not set)
priority            Priority label (Low / Medium / High / …)
current_status      Status of the issue at the time of the last sync
created             Creation timestamp — local time, no timezone
time_to_fix_days    Days from created → first terminal status (UTC, 2 dp)
environment         Value(s) of the Environment(s) custom field
discovered_in_phase Value of the Discovered in Phase custom field
root_cause          Value of the Root Cause custom field [customfield_12081]
transitions         All status changes: "From->To@YYYY-MM-DD HH:MM:SS;…"
transitions_steps   Total number of status transitions
"""

from transformations._lib import (
    field_value, format_local, status_transitions,
    first_terminal, format_transitions, time_to_fix_days,
    parse_dt,
)

OUTPUT = "data/gold/escaped_defects.csv"
FIELDS = [
    "query", "issue", "project", "type", "story_points", "priority",
    "current_status", "created", "time_to_fix_days", "environment",
    "discovered_in_phase", "root_cause", "transitions", "transitions_steps",
]


def transform(issues: list) -> list:
    rows = []

    for issue in issues:
        fields = issue.get("fields", {})

        if (fields.get("issuetype") or {}).get("name") != "Bug":
            continue

        env_str = field_value(fields.get("customfield_12589"))
        dip_str = field_value(fields.get("customfield_12017"))

        if "Production [PROD]" not in env_str and dip_str != "Production":
            continue

        created_iso = fields.get("created", "")
        created_dt  = parse_dt(created_iso)
        query       = created_dt.strftime("%Y-%m") if created_dt else ""

        transitions = status_transitions(issue)
        terminal_t  = first_terminal(transitions)
        ttf         = time_to_fix_days(created_iso, terminal_t)

        trans_str, trans_count = format_transitions(transitions)

        sp = fields.get("customfield_10005")
        priority = fields.get("priority")

        rows.append({
            "query":              query,
            "issue":              issue.get("key", ""),
            "project":            (fields.get("project")   or {}).get("key",  ""),
            "type":               (fields.get("issuetype") or {}).get("name", ""),
            "story_points":       f"{float(sp):.1f}" if sp is not None else "",
            "priority":           priority.get("name", "") if isinstance(priority, dict) else "",
            "current_status":     (fields.get("status") or {}).get("name", ""),
            "created":            format_local(created_iso),
            "time_to_fix_days":   f"{ttf:.2f}" if ttf is not None else "",
            "environment":        env_str,
            "discovered_in_phase": dip_str,
            "root_cause":         field_value(fields.get("customfield_12081")),
            "transitions":        trans_str,
            "transitions_steps":  trans_count,
        })

    rows.sort(key=lambda r: (r["query"], r["issue"]))
    return rows
