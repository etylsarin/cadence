"""agent_tools.py — read-only, path-jailed tool implementations for the Ask agent.

Each entry in TOOLS is {"schema": <Anthropic tool schema dict>, "fn": <callable>}.
The agent loop passes tool_schemas to the AI and dispatches tool_calls to fn(**input).

File tools are jailed to backend/data/silver/ and backend/data/gold/.
Domain tools are thin wrappers over mirror.py and mirror.status_at().
"""

import fnmatch
import json
import re
from pathlib import Path

import mirror as _mirror
from config import PROJECTS

_DATA    = Path(__file__).resolve().parent.parent.parent / "data"
_SILVER  = _DATA / "silver"
_GOLD    = _DATA / "gold"
_ALLOWED = (_SILVER.resolve(), _GOLD.resolve())


# ── Path jail ────────────────────────────────────────────────────────────────

def _resolve_safe(path_str: str) -> Path:
    """Resolve a relative path within silver/ or gold/ and reject anything unsafe.

    Accepts paths like "silver/ADM-1000.json" or "gold/flow_metrics.csv".
    Raises ValueError for absolute paths, '..' traversal, symlinks, or paths
    that resolve outside the two allowed roots.
    """
    if not path_str or path_str.startswith("/"):
        raise ValueError(f"Absolute paths are not allowed: {path_str!r}")
    if ".." in Path(path_str).parts:
        raise ValueError(f"Path traversal is not allowed: {path_str!r}")

    # Allow bare filenames: resolve against silver first, then gold.
    p = Path(path_str)
    if len(p.parts) == 1:
        for root in _ALLOWED:
            original = root / p
            if original.is_symlink():
                continue
            candidate = original.resolve()
            if candidate.is_file() and candidate.is_relative_to(root):
                return candidate
        raise ValueError(f"File not found: {path_str!r}")

    # Paths must start with "silver/" or "gold/".
    prefix = p.parts[0]
    if prefix == "silver":
        root = _SILVER
    elif prefix == "gold":
        root = _GOLD
    else:
        raise ValueError(f"Path must start with 'silver/' or 'gold/', got: {path_str!r}")

    original = root / Path(*p.parts[1:])
    if original.is_symlink():
        raise ValueError(f"Symlinks are not allowed: {path_str!r}")
    resolved = original.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f"Path escapes allowed directories: {path_str!r}")

    return resolved


def _glob_safe(glob_str: str) -> list[Path]:
    """Expand a glob pattern within silver/ or gold/, returning resolved paths."""
    p = Path(glob_str)
    if ".." in p.parts or glob_str.startswith("/"):
        raise ValueError(f"Invalid glob: {glob_str!r}")

    prefix = p.parts[0] if p.parts else ""
    if prefix == "silver":
        root = _SILVER
        pattern = str(Path(*p.parts[1:])) if len(p.parts) > 1 else "*"
    elif prefix == "gold":
        root = _GOLD
        pattern = str(Path(*p.parts[1:])) if len(p.parts) > 1 else "*"
    else:
        raise ValueError(f"Glob must start with 'silver/' or 'gold/', got: {glob_str!r}")

    results = []
    for candidate in root.glob(pattern):
        if candidate.is_symlink():
            continue
        resolved = candidate.resolve()
        if resolved.is_relative_to(root):
            results.append(resolved)
    return sorted(results)


# ── File tools ────────────────────────────────────────────────────────────────

def _tool_grep(pattern: str, glob: str, max_results: int = 50) -> str:
    """Regex-search across files matched by glob, returning matching lines."""
    max_results = min(max_results, 200)  # server-side cap regardless of what the model passes
    if len(pattern) > 200:
        raise ValueError(f"Pattern too long ({len(pattern)} chars, max 200)")
    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error as e:
        raise ValueError(f"Invalid regex pattern: {e}")

    files = _glob_safe(glob)
    lines_found = []
    for path in files:
        try:
            text = path.read_text(errors="replace")
        except OSError:
            continue
        # For JSON files, search the raw text so keys/values are visible.
        rel = _rel(path)
        for lineno, line in enumerate(text.splitlines(), 1):
            if regex.search(line):
                lines_found.append(f"{rel}:{lineno}: {line.strip()[:200]}")
                if len(lines_found) >= max_results:
                    lines_found.append(f"[capped at {max_results} — narrow your search]")
                    return "\n".join(lines_found)

    if not lines_found:
        return f"No matches for {pattern!r} in {glob}"
    return "\n".join(lines_found)


def _tool_read(path: str) -> str:
    """Read the full contents of a file in silver/ or gold/."""
    resolved = _resolve_safe(path)
    if not resolved.exists():
        raise ValueError(f"File not found: {path!r}")
    return resolved.read_text(errors="replace")


def _tool_list_files(glob: str) -> str:
    """List files matching a glob in silver/ or gold/, with sizes."""
    files = _glob_safe(glob)
    if not files:
        return f"No files match: {glob}"
    lines = [f"{_rel(p)}  ({p.stat().st_size:,} bytes)" for p in files]
    return "\n".join(lines)


def _rel(path: Path) -> str:
    """Return a short relative path like 'silver/ADM-1000.json'."""
    for root, prefix in ((_SILVER, "silver"), (_GOLD, "gold")):
        try:
            return f"{prefix}/{path.relative_to(root)}"
        except ValueError:
            pass
    return str(path)


# ── Domain tools ──────────────────────────────────────────────────────────────

def _tool_get_ticket(key: str) -> str:
    """Fetch a single ticket by key including its changelog/transitions."""
    m = _mirror.get_mirror()
    ticket = m.by_key.get(key.upper())
    if not ticket:
        return f"Ticket {key!r} not found in mirror."
    f = ticket.get("fields") or {}
    transitions = _mirror.status_transitions(ticket)
    return json.dumps({
        "key":         ticket.get("key"),
        "summary":     f.get("summary"),
        "type":        (f.get("issuetype") or {}).get("name"),
        "status":      (f.get("status") or {}).get("name"),
        "priority":    (f.get("priority") or {}).get("name"),
        "assignee":    ((f.get("assignee") or {}).get("displayName")),
        "created":     f.get("created", "")[:10],
        "updated":     f.get("updated", "")[:10],
        "description": (f.get("description") or "")[:500],
        "labels":      f.get("labels") or [],
        "sprints":     [sp.get("name") for sp in (f.get("customfield_10007") or []) if isinstance(sp, dict)],
        "epic":        f.get("customfield_10008") or ((f.get("parent") or {}).get("key")),
        "fixVersions": [v.get("name") for v in (f.get("fixVersions") or [])],
        "transitions": [{"at": ts, "from": fr, "to": to} for ts, fr, to in transitions],
    }, indent=2, ensure_ascii=False)


def _tool_get_epic(epic_key: str) -> str:
    """Return epic metadata and the list of all child tickets."""
    m = _mirror.get_mirror()
    epic = m.epics.get(epic_key.upper())
    children = m.children_by_epic.get(epic_key.upper(), [])
    if not epic and not children:
        return f"Epic {epic_key!r} not found."
    ef = (epic.get("fields") or {}) if epic else {}
    child_rows = []
    for t in children:
        tf = t.get("fields") or {}
        child_rows.append({
            "key":     t.get("key"),
            "summary": tf.get("summary", "")[:80],
            "status":  (tf.get("status") or {}).get("name"),
            "type":    (tf.get("issuetype") or {}).get("name"),
        })
    return json.dumps({
        "key":      epic_key.upper(),
        "summary":  ef.get("summary"),
        "status":   (ef.get("status") or {}).get("name"),
        "children": child_rows,
    }, indent=2, ensure_ascii=False)


def _tool_list_sprints(project: str) -> str:
    """List all sprints for a project with their dates and state."""
    m = _mirror.get_mirror()
    project = project.upper()
    sids = m.sprints_by_project.get(project, [])
    if not sids:
        return f"No sprints found for project {project!r}."
    rows = []
    for sid in sids:
        sp = m.sprints.get(sid, {})
        rows.append({
            "id":           sid,
            "name":         sp.get("name"),
            "state":        sp.get("state"),
            "startDate":    sp.get("startDate", "")[:10],
            "endDate":      sp.get("endDate", "")[:10],
            "completeDate": sp.get("completeDate", "")[:10],
            "ticketCount":  len(sp.get("_tickets") or []),
        })
    rows.sort(key=lambda r: r.get("startDate") or "", reverse=True)
    return json.dumps(rows, indent=2, ensure_ascii=False)


def _tool_get_sprint(sprint_id: str) -> str:
    """Return sprint metadata and the keys + statuses of its tickets."""
    m = _mirror.get_mirror()
    try:
        sid = int(sprint_id)
    except (ValueError, TypeError):
        return f"sprint_id must be numeric, got {sprint_id!r}."
    sp = m.sprints.get(sid)
    if not sp:
        return f"Sprint {sprint_id!r} not found."
    tickets = [
        {
            "key":     t.get("key"),
            "summary": (t.get("fields") or {}).get("summary", "")[:80],
            "status":  ((t.get("fields") or {}).get("status") or {}).get("name"),
            "type":    ((t.get("fields") or {}).get("issuetype") or {}).get("name"),
        }
        for t in (sp.get("_tickets") or [])
    ]
    return json.dumps({
        "id":           sid,
        "name":         sp.get("name"),
        "state":        sp.get("state"),
        "startDate":    sp.get("startDate", "")[:10],
        "endDate":      sp.get("endDate", "")[:10],
        "completeDate": sp.get("completeDate", "")[:10],
        "goal":         sp.get("goal"),
        "tickets":      tickets,
    }, indent=2, ensure_ascii=False)


def _tool_status_at(key: str, date: str) -> str:
    """Return the status of a ticket as of a given ISO date (changelog replay)."""
    m = _mirror.get_mirror()
    ticket = m.by_key.get(key.upper())
    if not ticket:
        return f"Ticket {key!r} not found."
    status = _mirror.status_at(ticket, date)
    return json.dumps({"key": key.upper(), "date": date, "status": status})


def _tool_list_versions(project: str) -> str:
    """List all fix-versions / releases for a project."""
    m = _mirror.get_mirror()
    project = project.upper()
    rows = [
        {
            "id":          vid,
            "name":        v.get("name"),
            "released":    v.get("released"),
            "releaseDate": v.get("releaseDate"),
            "startDate":   v.get("startDate"),
            "tickets":     v.get("description"),   # e.g. "14 tickets"
        }
        for vid, v in m.versions.items()
        if v.get("project") == project
    ]
    if not rows:
        return f"No versions found for project {project!r}."
    rows.sort(key=lambda r: r.get("releaseDate") or "", reverse=True)
    return json.dumps(rows, indent=2, ensure_ascii=False)


# ── Tool registry ─────────────────────────────────────────────────────────────

TOOLS = [
    {
        "schema": {
            "name": "grep",
            "description": (
                "Search ticket files with a regex pattern. "
                "Call this when you need to find tickets matching a keyword, phrase, "
                "assignee name, label, or any text that may appear in ticket fields. "
                "glob examples: 'silver/*.json' (all tickets), 'silver/ADM-*.json' (one project), "
                "'gold/flow_metrics.csv' (a specific gold file)."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern":     {"type": "string",  "description": "Python regex pattern (case-insensitive)."},
                    "glob":        {"type": "string",  "description": "File glob relative to data/; must start with 'silver/' or 'gold/'."},
                    "max_results": {"type": "integer", "description": "Max matching lines to return (default 50, max 200).", "default": 50, "maximum": 200},
                },
                "required": ["pattern", "glob"],
            },
        },
        "fn": _tool_grep,
    },
    {
        "schema": {
            "name": "read",
            "description": (
                "Read the full content of a single file in silver/ or gold/. "
                "Call this to inspect a specific ticket JSON (e.g. 'silver/ADM-1000.json') "
                "or a gold CSV file. Use grep first to identify relevant files."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path starting with 'silver/' or 'gold/'."},
                },
                "required": ["path"],
            },
        },
        "fn": _tool_read,
    },
    {
        "schema": {
            "name": "list_files",
            "description": (
                "List files matching a glob pattern with their sizes. "
                "Use this to discover what gold CSV files exist or how many silver tickets "
                "are present for a project."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "glob": {"type": "string", "description": "Glob relative to data/; e.g. 'gold/*.csv' or 'silver/MLP-*.json'."},
                },
                "required": ["glob"],
            },
        },
        "fn": _tool_list_files,
    },
    {
        "schema": {
            "name": "get_ticket",
            "description": (
                "Fetch a single ticket by its Jira key (e.g. 'ADM-1000') with full fields "
                "and status transition history. Call this when you need the full description, "
                "sprint membership, epic link, or exact workflow path of a known ticket."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Jira ticket key, e.g. 'ADM-1000'."},
                },
                "required": ["key"],
            },
        },
        "fn": _tool_get_ticket,
    },
    {
        "schema": {
            "name": "get_epic",
            "description": (
                "Fetch an epic and all its child tickets. "
                "Call this when the question concerns an initiative, epic, or feature and its "
                "associated work items. Returns the epic summary/status plus all children."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "epic_key": {"type": "string", "description": "Epic ticket key, e.g. 'ADM-500'."},
                },
                "required": ["epic_key"],
            },
        },
        "fn": _tool_get_epic,
    },
    {
        "schema": {
            "name": "list_sprints",
            "description": (
                "List all sprints for a project with dates, state, and ticket counts. "
                "Call this when you need to identify sprint IDs before calling get_sprint, "
                f"or to compare sprint velocity across the project. "
                f"Valid project keys: {', '.join(PROJECTS)}."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": f"Project key, one of: {', '.join(PROJECTS)}."},
                },
                "required": ["project"],
            },
        },
        "fn": _tool_list_sprints,
    },
    {
        "schema": {
            "name": "get_sprint",
            "description": (
                "Return a sprint's metadata and the list of all tickets it contains. "
                "Call this when you need the full scope of a specific sprint. "
                "Get sprint IDs from list_sprints first."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Numeric sprint ID (from list_sprints)."},
                },
                "required": ["sprint_id"],
            },
        },
        "fn": _tool_get_sprint,
    },
    {
        "schema": {
            "name": "status_at",
            "description": (
                "Return the status of a ticket as of a specific date, replayed from its changelog. "
                "Call this when the question asks what state a ticket was in at a past point in time, "
                "e.g. 'was ADM-1000 in progress during sprint 33?'"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "key":  {"type": "string", "description": "Jira ticket key."},
                    "date": {"type": "string", "description": "ISO date string, e.g. '2025-03-15'."},
                },
                "required": ["key", "date"],
            },
        },
        "fn": _tool_status_at,
    },
    {
        "schema": {
            "name": "list_versions",
            "description": (
                "List all fix-versions (releases) for a project with release dates and ticket counts. "
                "Call this when the question asks about a release, version, or what shipped in a "
                "particular release."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": f"Project key, one of: {', '.join(PROJECTS)}."},
                },
                "required": ["project"],
            },
        },
        "fn": _tool_list_versions,
    },
]
