"""
Throughput
==========
How many issues of each type did each project complete per calendar month?

An issue is counted exactly once — in the month its status first changed to
one of the terminal states: Closed, Done, Rejected, or Delivered.  This
mirrors the Jira JQL:

    status CHANGED TO (Closed, Done, Rejected, Delivered) DURING (period)

which deduplicates at the issue level regardless of re-opens / re-closes.
Re-opened and re-closed issues are counted only in the month of their
original first terminal transition.

Columns
-------
query             YYYY-MM of the terminal-status transition
project           Jira project key (as configured in config.env PROJECTS)
type              Issue type (Story, Bug, Task, Spike)
count             Number of issues that completed in this month/project/type
avg_story_points  Average story points of those issues (0.00 when none set)

Note: issues created before the silver data window (pre-2025-01) are not
present in the silver layer, so their completions will not appear here.
"""

from collections import defaultdict

from transformations._lib import first_terminal, parse_dt, status_transitions

OUTPUT = "data/gold/throughput.csv"
FIELDS = ["query", "project", "type", "count", "avg_story_points"]


def transform(issues: list) -> list:
    # (month, project, type) → set of issue keys (dedup within same bucket)
    keys_by_bucket = defaultdict(set)
    # (month, project, type) → list of story-point values
    sp_by_bucket = defaultdict(list)

    for issue in issues:
        key = issue.get("key", "")
        fields = issue.get("fields", {})
        project = (fields.get("project") or {}).get("key", "")
        itype = (fields.get("issuetype") or {}).get("name", "")
        sp = fields.get("customfield_10005")

        transitions = status_transitions(issue)

        # Count each issue exactly once — in the month of its first terminal transition.
        # This matches Jira JQL: status CHANGED TO (...) DURING (...) which deduplicates
        # at the issue level regardless of re-opens / re-closes.
        t = first_terminal(transitions)
        if not t:
            continue
        dt = parse_dt(t["created"])
        if not dt:
            continue
        month = dt.strftime("%Y-%m")
        bk = (month, project, itype)
        if key not in keys_by_bucket[bk]:
            keys_by_bucket[bk].add(key)
            if sp is not None:
                sp_by_bucket[bk].append(float(sp))

    rows = []
    for (month, project, itype), keys in sorted(keys_by_bucket.items()):
        sp_list = sp_by_bucket[(month, project, itype)]
        avg_sp = round(sum(sp_list) / len(sp_list), 2) if sp_list else 0.0
        rows.append(
            {
                "query": month,
                "project": project,
                "type": itype,
                "count": len(keys),
                "avg_story_points": f"{avg_sp:.2f}",
            }
        )
    return rows
