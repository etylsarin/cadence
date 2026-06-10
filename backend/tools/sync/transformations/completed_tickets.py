"""
Completed Tickets
=================
One row per issue that reached a terminal status (Closed, Done, Rejected,
or Delivered), recording the exact date it was first completed.

This is the source table used by the Crystal Ball prediction models:

  • Monte Carlo simulation  — samples from the per-project completion history,
    buckets completions into 14-day windows, runs 10 000 trials to build a
    distribution of "days to finish N items", reports P50/P70/P85/P90/P95.

  • Cycle Time Scatterplot  — plots each ticket as a dot (completed_date × cycle
    time in days) and draws P50/P85/P90/P95 as horizontal SLA reference lines.
    The raw scatter makes outliers and the "tail" immediately visible.

Both models need the same data.  The backend endpoint buckets or scatters at
query time; no aggregation is done here.

Columns
-------
completed_date    YYYY-MM-DD of the first terminal-status transition (UTC)
issue             Jira issue key (e.g. PROJ-1234)
project           Jira project key (as configured in config.env PROJECTS)
type              Issue type (Story or Bug only, aligned with Flow Metrics)
story_points      Story points as a float, or "" when not set
cycle_time_days   Delivery Lead Time in days, using the same criteria as Flow
                  Metrics: time spent only in statuses mapped to work + idle
                  groups, up to the first terminal transition.
fix_version_ids   Semicolon-joined Jira version IDs the ticket is fixed in.
fix_version_names Semicolon-joined Jira version names the ticket is fixed in.

Deduplication: if an issue was re-opened and re-closed, it is counted only
once — in the calendar date of its *first* terminal-status transition.  This
mirrors the same logic used by throughput.py.
"""

from typing import Optional

from transformations._lib import dlt_days, field_value, load_flow_status_map, parse_dt, status_transitions, first_terminal

FLOW_ISSUE_TYPES = {"Story", "Bug"}

OUTPUT = "data/gold/completed_tickets.csv"
FIELDS = ["completed_date", "issue", "project", "type", "story_points", "cycle_time_days", "fix_version_ids", "fix_version_names"]


def build_rows(issues: list, allowed_types: Optional[set]) -> list:
    """Shared row builder. Pass allowed_types=None to keep every issue type."""
    status_map = load_flow_status_map()
    rows = []

    for issue in issues:
        key    = issue.get("key", "")
        fields = issue.get("fields", {})
        project = (fields.get("project")   or {}).get("key",  "")
        itype   = (fields.get("issuetype") or {}).get("name", "")
        sp      = fields.get("customfield_10005")

        if allowed_types is not None and itype not in allowed_types:
            continue

        transitions = status_transitions(issue)
        t = first_terminal(transitions)
        if not t:
            continue

        dt = parse_dt(t["created"])
        if not dt:
            continue

        # Use the same DLT criteria as Flow Metrics so Crystal Ball is aligned.
        cycle_time = ""
        lead_time = dlt_days(fields.get("created", ""), transitions, status_map)
        if lead_time is not None:
            cycle_time = f"{lead_time:.1f}"

        fvs = fields.get("fixVersions") or []
        fix_version_ids   = "; ".join(v.get("id", "") for v in fvs if isinstance(v, dict) and v.get("id"))
        fix_version_names = field_value(fvs)

        rows.append({
            "completed_date":    dt.strftime("%Y-%m-%d"),
            "issue":             key,
            "project":           project,
            "type":              itype,
            "story_points":      f"{float(sp):.1f}" if sp is not None else "",
            "cycle_time_days":   cycle_time,
            "fix_version_ids":   fix_version_ids,
            "fix_version_names": fix_version_names,
        })

    # Oldest completions first — makes the CSV easy to inspect and diff
    rows.sort(key=lambda r: (r["completed_date"], r["issue"]))
    return rows


def transform(issues: list) -> list:
    return build_rows(issues, FLOW_ISSUE_TYPES)
