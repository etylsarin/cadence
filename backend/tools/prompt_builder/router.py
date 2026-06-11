"""Prompt Builder — FastAPI router.

All routes are mounted under the /prompt-builder prefix by server.py.

Data source: the synced local mirror (backend/mirror.py over data/silver/).
The tool composes a copy-paste-ready Claude prompt from a ticket's title,
description, epic, issue links and attachments — fully offline, no AI call.
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from config import PROJECTS, load_config, validate_project
from mirror import TERMINAL_STATUSES, get_mirror
from tools.prompt_builder.prompt import build_prompt
from tools.release_notes.adf import field_text

# Default project for query params — first key from config.env PROJECTS.
DEFAULT_PROJECT = PROJECTS[0] if PROJECTS else ""

EPIC_LINK_FIELD = "customfield_10008"

_KEY_RE = re.compile(r"[A-Z][A-Z0-9]*-\d+")

router = APIRouter()
log = logging.getLogger(__name__)


# ── Mirror data helpers ────────────────────────────────────────────────────────

def _validate_key(key: str) -> str:
    if not _KEY_RE.fullmatch(str(key)):
        raise HTTPException(status_code=400, detail="Invalid ticket key")
    return key


def _ticket_record(key: str) -> dict:
    t = get_mirror().by_key.get(key)
    if not t:
        raise HTTPException(status_code=404, detail=f"Ticket {key} not found in the synced mirror")
    return t


def _project_of(ticket: dict) -> str:
    f = ticket.get("fields") or {}
    return ((f.get("project") or {}).get("key", "")) or ticket.get("key", "").split("-")[0]


def _epic_info(fields: dict) -> Optional[dict]:
    ek = fields.get(EPIC_LINK_FIELD) or ((fields.get("parent") or {}).get("key", ""))
    if not ek:
        return None
    epic = get_mirror().by_key.get(ek)
    ef = (epic or {}).get("fields") or {}
    return {
        "key": ek,
        "summary": ef.get("summary", ""),
        "description": field_text(ef, "description"),
    }


def _link_items(fields: dict) -> list:
    mirror = get_mirror()
    items = []
    for link in fields.get("issuelinks") or []:
        ltype = link.get("type") or {}
        for direction, relation_key in (("outwardIssue", "outward"), ("inwardIssue", "inward")):
            other = link.get(direction)
            if not other:
                continue
            key = other.get("key", "")
            synced = mirror.by_key.get(key)
            items.append({
                "relation": ltype.get(relation_key) or ltype.get("name", "relates to"),
                "key":      key,
                "status":   (((other.get("fields") or {}).get("status")) or {}).get("name", ""),
                "summary":  ((synced or {}).get("fields") or {}).get("summary", ""),
            })
    return items


def _attachment_items(fields: dict) -> list:
    return [{
        "filename": a.get("filename", ""),
        "mimeType": a.get("mimeType", ""),
        "size":     a.get("size"),
        "created":  (a.get("created") or "")[:10],
    } for a in fields.get("attachment") or [] if isinstance(a, dict)]


def _ticket_detail(key: str) -> dict:
    t = _ticket_record(key)
    f = t.get("fields") or {}
    return {
        "key":         key,
        "summary":     f.get("summary", ""),
        "type":        (f.get("issuetype") or {}).get("name", ""),
        "status":      (f.get("status") or {}).get("name", ""),
        "priority":    (f.get("priority") or {}).get("name", "None") or "None",
        "project":     _project_of(t),
        "created":     (f.get("created") or "")[:10],
        "updated":     (f.get("updated") or "")[:10],
        "description": field_text(f, "description"),
        "epic":        _epic_info(f),
        "links":       _link_items(f),
        "attachments": _attachment_items(f),
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/api/squads")
def api_squads(project: str = Query(DEFAULT_PROJECT)):
    if project != "ALL":
        validate_project(project)
    try:
        labels: set = set()
        m = get_mirror()
        for t in m.tickets:
            if project != "ALL" and _project_of(t) != project:
                continue
            f = t.get("fields") or {}
            labels.update(f.get("labels") or [])
        return {"squads": sorted(labels)}
    except Exception:
        log.exception("Error listing squads for %s", project)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/tickets")
def api_tickets(
    project:    str  = Query(DEFAULT_PROJECT),
    squad:      str  = Query(""),
    search:     str  = Query(""),
    unfinished: bool = Query(True),
    finished:   bool = Query(False),
    limit:      int  = Query(30),
    offset:     int  = Query(0),
):
    if project != "ALL":
        validate_project(project)
    needle = search.strip().lower()
    squad_filter = squad.strip()
    items = []
    for t in get_mirror().tickets:
        if project != "ALL" and _project_of(t) != project:
            continue
        f = t.get("fields") or {}
        itype = (f.get("issuetype") or {}).get("name", "")
        if itype == "Epic":
            continue
        status = (f.get("status") or {}).get("name", "")
        is_finished = status in TERMINAL_STATUSES
        if is_finished and not finished:
            continue
        if not is_finished and not unfinished:
            continue
        key, summary = t.get("key", ""), f.get("summary", "") or ""
        if needle and needle not in key.lower() and needle not in summary.lower():
            continue
        if squad_filter and squad_filter not in (f.get("labels") or []):
            continue
        items.append({
            "key":      key,
            "summary":  summary,
            "type":     itype,
            "status":   status,
            "updated":  (f.get("updated") or "")[:10],
        })
    items.sort(key=lambda i: (i["updated"], i["key"]), reverse=True)
    return {
        "items":   items[offset:offset + limit],
        "total":   len(items),
        "hasMore": offset + limit < len(items),
    }


@router.get("/api/ticket/{key}")
def api_ticket(key: str):
    _validate_key(key)
    config = load_config()
    detail = _ticket_detail(key)
    detail["jiraUrl"] = config.get("JIRA_URL", "").rstrip("/")
    return detail


class PromptRequest(BaseModel):
    key: str
    include: Optional[dict] = {}      # description / epic / links / attachments → bool
    instruction: Optional[str] = ""


@router.post("/api/prompt")
def api_prompt(req: PromptRequest):
    _validate_key(req.key)
    try:
        detail = _ticket_detail(req.key)
        return {"prompt": build_prompt(detail, req.include or {}, req.instruction or "")}
    except HTTPException:
        raise
    except Exception:
        log.exception("Error building prompt for ticket %s", req.key)
        raise HTTPException(status_code=500, detail="Internal server error")
