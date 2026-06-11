"""Planner — FastAPI router.

All routes are mounted under the /planner prefix by server.py.

Data sources:
  • Throughput: rolling N-month average items/month per project from
    data/gold/throughput.csv (produced by Sync).
  • Idle tail: rolling N-month P85 idle (wait-stage) days per project from
    data/gold/flow_metrics.csv — the "release flush" time appended to each
    epic's body in the timeline.
  • Epics + their children: live Jira via /rest/api/3/search/jql.

The simulation itself runs on the frontend so the "what changes if" sliders
stay interactive without a round-trip.
"""

from __future__ import annotations

import csv
import os
import time
from collections import defaultdict
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from config import JIRA_URL, PROJECTS, validate_project
from mirror import get_mirror
from tools.flow_metrics.flow_shared import get_months

router = APIRouter()


# ── Throughput from gold ──────────────────────────────────────────────────────

_GOLD_THROUGHPUT = os.path.join(os.path.dirname(__file__), "../../data/gold/throughput.csv")

_throughput_cache: tuple[float, list[dict]] | None = None
_THROUGHPUT_TTL = 300  # 5 min


def _load_throughput_rows() -> list[dict]:
    """Read throughput.csv into memory, cached for _THROUGHPUT_TTL seconds."""
    global _throughput_cache
    now = time.time()
    if _throughput_cache and (now - _throughput_cache[0]) < _THROUGHPUT_TTL:
        return _throughput_cache[1]

    rows: list[dict] = []
    if os.path.exists(_GOLD_THROUGHPUT):
        with open(_GOLD_THROUGHPUT, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    rows.append({
                        "month":   r.get("query", ""),         # YYYY-MM
                        "project": r.get("project", ""),
                        "type":    r.get("type", ""),
                        "count":   int(r.get("count", "0") or 0),
                    })
                except ValueError:
                    continue
    _throughput_cache = (now, rows)
    return rows


def _current_month_str() -> str:
    """Today as YYYY-MM. The boundary between 'complete' (counted) and
    'incomplete' (skipped) months."""
    t = date.today()
    return f"{t.year}-{t.month:02d}"


def _split_complete(months: set[str]) -> tuple[list[str], list[str]]:
    """Partition a set of YYYY-MM strings into (complete, excluded).

    A month is complete iff it's strictly before the current calendar month.
    The current month is mid-flight (the pipeline still writes a partial-count
    row for it) and future months haven't happened — both drag throughput and
    idle-tail averages down if we let them divide the total. Returns both sides
    sorted so the API can surface what was actually used and what got skipped."""
    cur = _current_month_str()
    complete: list[str] = []
    excluded: list[str] = []
    for m in sorted(months):
        (complete if m < cur else excluded).append(m)
    return complete, excluded


def _avg_over_months(rows: list[dict], selected_months: set[str], types: list[str] | None) -> dict:
    """Average items/month per project over an arbitrary set of months.

    Only *complete* months are counted (see [_split_complete]) — the current
    month's partial-count row would otherwise pull the average down. If every
    selected month is incomplete (e.g. the user picks only the current month),
    items_per_month is 0 and the as_of field is null; the caller can decide
    whether to surface that or fall back to a wider window."""
    complete, excluded = _split_complete(selected_months)
    complete_set = set(complete)

    counts_by_proj: dict[str, int] = defaultdict(int)
    for r in rows:
        if r["month"] not in complete_set:
            continue
        if types and r["type"] not in types:
            continue
        counts_by_proj[r["project"]] += r["count"]

    n_months = max(1, len(complete))

    # Integer items/month — matches the Flow Metrics throughput page so users
    # don't see "8" in one place and "8.3" in the other for the same number.
    items_per_month: dict[str, int] = {}
    for proj in PROJECTS:
        items_per_month[proj] = round(counts_by_proj.get(proj, 0) / n_months) if complete else 0

    return {
        "items_per_month": items_per_month,
        "months_window":   len(complete),
        "as_of":           complete[-1] if complete else None,
        "months_used":     complete,
        "months_excluded": excluded,   # incomplete (current) and future months the picker offered
    }


def _months_from_query(
    window: Optional[int],
    gran:   Optional[str],
    years:  list[int],
    periods: list[str],
) -> set[str]:
    """Resolve a planner-style timeframe payload into a set of YYYY-MM months.

    Accepts EITHER the legacy `window=N` (rolling last N months anchored on
    today, kept for backwards compatibility) OR the Flow-Metrics-style
    `gran/years/periods` triplet. If both are supplied, the explicit triplet
    wins because it's more specific."""
    if gran and years:
        return get_months(gran, years, periods or [])
    n = max(1, min(int(window or 3), 24))
    today = date.today()
    out: set[str] = set()
    for i in range(n):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        out.add(f"{y}-{m:02d}")
    return out


@router.get("/api/throughput")
def api_throughput(
    window:  Optional[int]       = Query(None, ge=1, le=24),
    gran:    Optional[str]       = Query(None),
    years:   List[int]           = Query(default=[]),
    periods: List[str]           = Query(default=[]),
    types:   List[str]           = Query(default=["Story", "Bug", "Task", "Spike"]),
):
    """Per-project items/month over a timeframe.

    Pass `gran/years/periods` for an explicit Flow-Metrics-shaped selection
    (e.g. gran=M, years=[2026], periods=['Mar','Apr','May']), or the legacy
    `window=N` for "rolling last N months anchored on today"."""
    months = _months_from_query(window, gran, years, periods)
    return _avg_over_months(_load_throughput_rows(), months, types)


# ── Mirror: list recent epics ─────────────────────────────────────────────────

# Completed epics are never useful for planning future work.
_EXCLUDED_EPIC_STATUSES = {
    "Done", "Closed", "Rejected", "Delivered", "Cancelled", "Won't Do",
    "Approved for PROD env",
}


def _child_payload(t: dict, epic_key: str) -> dict:
    f = t.get("fields") or {}
    blocks: list[str] = []
    blocked_by: list[str] = []
    for link in (f.get("issuelinks") or []):
        lt = link.get("type") or {}
        if lt.get("outward", "").lower() == "blocks" and "outwardIssue" in link:
            blocks.append(link["outwardIssue"]["key"])
        if lt.get("inward", "").lower() == "is blocked by" and "inwardIssue" in link:
            blocked_by.append(link["inwardIssue"]["key"])
    return {
        "key":        t.get("key", ""),
        "summary":    f.get("summary", "") or "",
        "type":       ((f.get("issuetype") or {}).get("name", "") or ""),
        "status":     ((f.get("status") or {}).get("name", "") or ""),
        "parent":     epic_key,
        "blocks":     blocks,
        "blocked_by": blocked_by,
    }


@router.get("/api/epics")
def api_epics(
    project: str = Query(...),
    limit: int = Query(50, ge=1, le=100),
):
    """Recent *open* epics for a project from the synced mirror,
    newest-updated first, with per-status child counts for the picker."""
    if project != "ALL":
        validate_project(project)
    m = get_mirror()
    epics: list[dict] = []
    for key, t in m.epics.items():
        f = t.get("fields") or {}
        if project != "ALL" and ((f.get("project") or {}).get("key", "")) != project:
            continue
        status = ((f.get("status") or {}).get("name", "") or "")
        if status in _EXCLUDED_EPIC_STATUSES:
            continue
        by_status: dict[str, int] = defaultdict(int)
        children = m.children_by_epic.get(key, [])
        for c in children:
            cs = ((c.get("fields") or {}).get("status") or {}).get("name", "")
            if cs:
                by_status[cs] += 1
        proj_key = (f.get("project") or {}).get("key", "") or key.split("-")[0]
        epics.append({
            "key":      key,
            "summary":  f.get("summary", "") or "",
            "status":   status,
            "priority": ((f.get("priority") or {}).get("name", "") or ""),
            "updated":  (f.get("updated") or "")[:10],
            "created":  (f.get("created") or "")[:10],
            "project":  proj_key,
            "child_count":         len(children),
            "child_status_counts": dict(by_status),
        })
    epics.sort(key=lambda e: e["updated"], reverse=True)
    return {"epics": epics[:limit], "project": project, "stale": False}


# ── Mirror: fetch children of selected epics ──────────────────────────────────

class EpicChildrenRequest(BaseModel):
    epic_keys: list[str]


_EPIC_KEY_RE = __import__("re").compile(r"^[A-Z][A-Z0-9_]*-\d+$")


def _fetch_children(epic_keys: list[str]) -> list[dict]:
    """Direct children of the given epics from the synced mirror.

    Returns one flat list of child issues, each tagged with its parent epic key.
    Includes terminal/early statuses so the UI can show the full breakdown and
    let the user pick which statuses count as "in scope".
    """
    m = get_mirror()
    all_items: list[dict] = []
    for ek in epic_keys:
        all_items.extend(_child_payload(t, ek) for t in m.children_by_epic.get(ek, []))
    all_items.sort(key=lambda c: (c["parent"], c["key"]))
    return all_items


@router.post("/api/epic-children")
def api_epic_children(req: EpicChildrenRequest):
    """Return children for a list of epic keys, grouped by parent + status breakdown.

    The frontend decides which statuses count as "in scope" for the queue.
    """
    keys = [k.strip().upper() for k in req.epic_keys if k and k.strip()]
    bad = [k for k in keys if not _EPIC_KEY_RE.match(k)]
    if bad:
        raise HTTPException(status_code=400, detail=f"Invalid epic key(s): {', '.join(bad)}")
    if not keys:
        return {"epics": [], "all_statuses": []}

    children = _fetch_children(keys)

    by_parent: dict[str, list[dict]] = defaultdict(list)
    for c in children:
        if c["parent"]:
            by_parent[c["parent"]].append(c)

    all_statuses: dict[str, int] = defaultdict(int)
    epics_out: list[dict] = []
    for k in keys:
        kids = by_parent.get(k, [])
        status_breakdown: dict[str, int] = defaultdict(int)
        for c in kids:
            status_breakdown[c["status"]] += 1
            all_statuses[c["status"]] += 1
        epics_out.append({
            "key":              k,
            "project":          k.split("-")[0] if "-" in k else "",
            "children":         kids,
            "status_breakdown": dict(status_breakdown),
            "total":            len(kids),
        })

    return {
        "epics":        epics_out,
        "all_statuses": [{"name": s, "count": c} for s, c in sorted(all_statuses.items(), key=lambda kv: -kv[1])],
        "jira_url":     JIRA_URL,
    }


@router.get("/api/ticket-epics")
def api_ticket_epics(keys: List[str] = Query(...)):
    """Given a list of ticket keys, return their parent epic key (if known).

    Used by the frontend to detect missing cross-epic blocking dependencies
    when the user adds an epic to the plan.
    """
    if not keys:
        return {}
    key_set = set(keys)
    m = get_mirror()
    result: dict[str, str] = {}
    EPIC_LINK_FIELD = "customfield_10008"
    for t in m.tickets:
        k = t.get("key", "")
        if k not in key_set:
            continue
        f = t.get("fields") or {}
        parent_key = (
            ((f.get("parent") or {}).get("key", ""))
            or (f.get(EPIC_LINK_FIELD, "") or "")
        )
        if parent_key:
            result[k] = parent_key
    return result
