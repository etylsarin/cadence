"""
Completed Tickets — all issue types
===================================
Same as completed_tickets.py but without the Story/Bug restriction. Includes
every issue type that reaches a terminal status (Story, Bug, Task, Spike, …).

Used by Crystal Ball → Cycle Time, which lets the user pick which types to
include in the histogram. The narrow `completed_tickets.csv` is still the
source for Flow-Metrics-aligned tools (Tilt, Release Intelligence,
Monte Carlo), so widening here does not change their behavior.
"""

from transformations.completed_tickets import build_rows

OUTPUT = "data/gold/completed_tickets_all.csv"
FIELDS = ["completed_date", "issue", "project", "type", "story_points", "cycle_time_days", "fix_version_ids", "fix_version_names"]


def transform(issues: list) -> list:
    return build_rows(issues, allowed_types=None)
