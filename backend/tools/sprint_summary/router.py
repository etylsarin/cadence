"""Sprint Summary — FastAPI router.

All routes are mounted under the /sprint-summary prefix by server.py.

Data source: the synced local mirror (backend/mirror.py over data/silver/).
Sprint entities come from the sprint custom field on synced tickets; the
sprint report (status at sprint end, injected, carried over) is replayed
from each ticket's changelog — no live Jira calls.
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from config import PROJECTS, load_config, validate_numeric_id, validate_project
from mirror import TERMINAL_STATUSES, get_mirror, status_at

# Default project for query params — first key from config.env PROJECTS.
DEFAULT_PROJECT = PROJECTS[0] if PROJECTS else ""

router = APIRouter()
log = logging.getLogger(__name__)

STATUS_COMPLETED = "Approved for PROD env"


# ── Sprint data helpers ────────────────────────────────────────────────────────

def get_sprints(project: str) -> list:
    m = get_mirror()
    sprints = sorted(
        (m.sprints[sid] for sid in m.sprints_by_project.get(project, [])),
        key=lambda s: s["id"],
        reverse=True,
    )
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "state": s["state"],
            "startDate": s.get("startDate", ""),
            "endDate": s.get("endDate", ""),
        }
        for s in sprints
    ]


def _points(raw) -> float:
    try:
        return float(raw) if raw is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def get_sprint_summary(project: str, sprint_id: str) -> dict:
    m = get_mirror()
    sprint = m.sprints.get(int(sprint_id))
    if not sprint or sprint["_project"] != project:
        raise ValueError(f"Sprint {sprint_id} not found for {project}")

    start  = sprint.get("startDate", "")
    cutoff = sprint.get("completeDate", "") or sprint.get("endDate", "")

    all_issues = []
    for t in sprint["_tickets"]:
        f   = t.get("fields") or {}
        key = t.get("key", "")

        status_at_end  = status_at(t, cutoff)
        current_status = (f.get("status") or {}).get("name", "")
        delivered      = status_at_end in TERMINAL_STATUSES
        approved       = current_status == STATUS_COMPLETED

        # Carried over: member of a later sprint and not done in this one.
        later = any(
            isinstance(sp, dict) and isinstance(sp.get("id"), int) and sp["id"] > sprint["id"]
            for sp in f.get("customfield_10007") or []
        )
        removed  = (not delivered) and later
        injected = bool(start) and f.get("created", "") > start

        pts  = _points(f.get("customfield_10005"))
        ek   = f.get("customfield_10008") or ((f.get("parent") or {}).get("key", "")) or ""
        epic = m.epics.get(ek)
        fv   = (f.get("fixVersions") or [{}])[0]

        all_issues.append({
            "key":         key,
            "summary":     f.get("summary", ""),
            "type":        (f.get("issuetype") or {}).get("name", ""),
            "status":      status_at_end,
            "points":      int(pts) if pts == int(pts) else pts,
            "injected":    injected,
            "removed":     removed,
            "delivered":   delivered,
            "approved":    approved,
            "completed":   delivered or approved,
            "fixVersion":  fv.get("name", ""),
            "releaseDate": fv.get("releaseDate", ""),
            "epicKey":     ek,
            "epicName":    ((epic.get("fields") or {}).get("summary", ek) if epic else ek),
        })

    all_issues.sort(key=lambda i: i["key"])

    points_map     = {i["key"]: i["points"] for i in all_issues}
    all_keys       = set(points_map)
    injected_keys  = {i["key"] for i in all_issues if i["injected"]}
    planned_keys   = all_keys - injected_keys
    delivered_keys = {i["key"] for i in all_issues if i["delivered"]}
    approved_keys  = {i["key"] for i in all_issues if i["approved"]}
    completed_keys = delivered_keys | approved_keys

    def _metric(keys, available=True):
        pts = sum(points_map.get(k, 0.0) for k in keys)
        return {
            "count":     len(keys),
            "points":    int(pts) if pts == int(pts) else pts,
            "available": available,
            "keys":      sorted(keys),
        }

    config = load_config()
    return {
        "sprint": {
            "id":           sprint["id"],
            "name":         sprint["name"],
            "state":        sprint["state"],
            "startDate":    sprint.get("startDate", ""),
            "endDate":      sprint.get("endDate", ""),
            "completeDate": sprint.get("completeDate", ""),
            "goal":         sprint.get("goal", ""),
        },
        "boardId":     sprint["id"] // 1000,
        "data_source": "mirror",
        "jiraUrl":     config.get("JIRA_URL", "").rstrip("/"),
        "issues":      all_issues,
        "rows": {
            "planned": {
                **_metric(planned_keys),
                "delivered": _metric(planned_keys & delivered_keys),
                "approved":  _metric(planned_keys & approved_keys),
                "completed": _metric(planned_keys & completed_keys),
            },
            "injected": {
                **_metric(injected_keys),
                "delivered": _metric(injected_keys & delivered_keys),
                "approved":  _metric(injected_keys & approved_keys),
                "completed": _metric(injected_keys & completed_keys),
            },
            "total": {
                **_metric(all_keys),
                "delivered": _metric(delivered_keys),
                "approved":  _metric(approved_keys),
                "completed": _metric(completed_keys),
            },
        },
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/api/sprints")
def api_sprints(
    project: str = Query(DEFAULT_PROJECT),
    limit:   int = Query(10),
    offset:  int = Query(0),
):
    validate_project(project)
    try:
        all_items = get_sprints(project)
        return {
            "items":   all_items[offset:offset + limit],
            "total":   len(all_items),
            "hasMore": offset + limit < len(all_items),
        }
    except Exception:
        log.exception("Error listing sprints for %s", project)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/sprint-summary")
def api_sprint_summary(
    project: str = Query(DEFAULT_PROJECT),
    sprint_id: str = Query(...),
):
    validate_project(project)
    validate_numeric_id(sprint_id, "sprint_id")
    try:
        return get_sprint_summary(project, sprint_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception:
        log.exception("Error building sprint summary for %s/%s", project, sprint_id)
        raise HTTPException(status_code=500, detail="Internal server error")
