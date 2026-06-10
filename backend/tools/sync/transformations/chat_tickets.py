"""
Chat Tickets
============
One JSON object per issue, stripped to only the fields useful for
natural-language Q&A (scrum master, PM, team lead, stakeholder questions).

The output is a JSONL file (one JSON object per line) at data/gold/chat_tickets.jsonl.
Each line is self-contained so the consumer can filter cheaply by project,
date, type, etc. before loading into a Claude context window.

Fields kept
-----------
key             Jira issue key (e.g. ACCS-1234)
summary         Issue title
description     First ~300 chars of plain text (stripped from Jira doc format)
type            Issue type name (Story, Bug, Task, Spike, …)
project         Project / squad key (ACCS, CONS, ENGS, NBLMNT, TRAS, …)
status          Current status name
priority        Priority name (Highest, High, Medium, Low, Lowest)
assignee        Display name of current assignee, or null
story_points    Float or null
sprint          Name of the most recent sprint the issue was in, or null
epic            Parent epic key, or null
labels          List of label strings
created         YYYY-MM-DD
updated         YYYY-MM-DD
resolved        YYYY-MM-DD or null (date of first terminal-status transition)
transitions     [{from, to, date}] — status changes only, oldest first
root_cause      (bugs only) root cause category string
environment     (bugs only) environment string (e.g. "Production [PROD]")
discovered_in_phase  (bugs only) phase string (e.g. "Production")
"""

from transformations._lib import (
    field_value,
    parse_dt,
    status_transitions,
    first_terminal,
)

OUTPUT = "data/gold/chat_tickets.jsonl"
FIELDS = []  # Not used — JSONL writer ignores this


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_text(node, parts: list):
    """Recursively pull plain text out of a Jira document node."""
    if isinstance(node, str):
        parts.append(node)
    elif isinstance(node, dict):
        if node.get("type") == "text":
            parts.append(node.get("text", ""))
        for child in node.get("content", []):
            _extract_text(child, parts)
    elif isinstance(node, list):
        for item in node:
            _extract_text(item, parts)


def _description_text(desc, max_chars: int = 300) -> str:
    if not desc:
        return ""
    if isinstance(desc, str):
        return desc[:max_chars].strip()
    parts: list = []
    _extract_text(desc, parts)
    text = " ".join(p.strip() for p in parts if p.strip())
    return text[:max_chars]


_SPRINT_STATE_ORDER = {"active": 0, "closed": 1, "future": 2}


def _sprint_name(sprint_field):
    """Return the name of the most relevant sprint (active > closed > future)."""
    if not sprint_field or not isinstance(sprint_field, list):
        return None
    candidates = [s for s in sprint_field if isinstance(s, dict) and s.get("name")]
    if not candidates:
        return None
    def _sprint_sort_key(s):
        dt = parse_dt(s.get("endDate", "") or "")
        ts = dt.timestamp() if dt else 0
        return (_SPRINT_STATE_ORDER.get(s.get("state", "future"), 3), -ts)

    candidates.sort(key=_sprint_sort_key)
    return candidates[0]["name"]


def _ymd(iso_str: str):
    """Return 'YYYY-MM-DD' from an ISO timestamp, or None."""
    if not iso_str:
        return None
    dt = parse_dt(iso_str)
    return dt.strftime("%Y-%m-%d") if dt else None


# ── Transformation ────────────────────────────────────────────────────────────

def transform(issues: list) -> list:
    rows = []

    for issue in issues:
        key    = issue.get("key", "")
        fields = issue.get("fields", {})

        itype   = (fields.get("issuetype") or {}).get("name", "")
        project = (fields.get("project")   or {}).get("key",  "")
        status  = (fields.get("status")    or {}).get("name", "")
        priority = (fields.get("priority") or {}).get("name", "")
        assignee = (fields.get("assignee") or {}).get("displayName") or None
        sp       = fields.get("customfield_10005")

        transitions = status_transitions(issue)
        terminal_t  = first_terminal(transitions)

        row = {
            "key":         key,
            "summary":     fields.get("summary", ""),
            "description": _description_text(fields.get("description")),
            "type":        itype,
            "project":     project,
            "status":      status,
            "priority":    priority,
            "assignee":    assignee,
            "story_points": float(sp) if sp is not None else None,
            "sprint":      _sprint_name(fields.get("customfield_10007")),
            "epic":        fields.get("customfield_10008") or None,
            "labels":      fields.get("labels") or [],
            "created":     _ymd(fields.get("created", "")),
            "updated":     _ymd(fields.get("updated", "")),
            "resolved":    _ymd(terminal_t["created"]) if terminal_t else None,
            "transitions": [
                {"from": t["from"], "to": t["to"], "date": _ymd(t["created"])}
                for t in transitions
            ],
        }

        # Bug-specific quality fields
        if itype == "Bug":
            row["root_cause"]          = field_value(fields.get("customfield_12081")) or None
            row["environment"]         = field_value(fields.get("customfield_12589")) or None
            row["discovered_in_phase"] = field_value(fields.get("customfield_12017")) or None

        rows.append(row)

    rows.sort(key=lambda r: (r["project"], r["key"]))
    return rows
