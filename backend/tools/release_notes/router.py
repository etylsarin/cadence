"""Release Notes — FastAPI router.

All routes are mounted under the /release-notes prefix by server.py.

Data source: the synced local mirror (backend/mirror.py over data/silver/) —
versions are aggregated from the fixVersions baked into synced tickets.
Only the AI generation step leaves the machine.
"""

import logging
from typing import Optional

from config import PROJECTS, load_config, validate_numeric_id, validate_project
from fastapi import APIRouter, HTTPException, Query
from mirror import get_mirror
from pydantic import BaseModel

from tools.release_notes.adf import field_text
from tools.release_notes.claude import (
    build_prompt,
    generate_with_ai,
    regenerate_section,
)

# Default project for query params — first key from config.env PROJECTS.
DEFAULT_PROJECT = PROJECTS[0] if PROJECTS else ""

router = APIRouter()
log = logging.getLogger(__name__)


# ── Mirror data helpers ────────────────────────────────────────────────────────


def get_versions(
    project: str,
    include_unreleased: bool = True,
    include_released: bool = False,
    include_archived: bool = False,
) -> list:
    versions = []
    for v in get_mirror().versions.values():
        if project != "ALL" and v["project"] != project:
            continue
        if v["archived"] and not include_archived:
            continue
        if (v["released"] and include_released) or (not v["released"] and include_unreleased):
            versions.append({
                "id": v["id"], "name": v["name"], "project": v["project"],
                "description": v["description"],
                "releaseDate": v["releaseDate"],
                "startDate": v["startDate"],
                "released": v["released"],
            })
    # No date → top, then by releaseDate descending (most recent first)
    versions.sort(
        key=lambda v: (
            (1, -(int(v["releaseDate"].replace("-", ""))))
            if v["releaseDate"]
            else (0, 0)
        )
    )
    return versions


def _version_record(version_id: str) -> dict:
    v = get_mirror().versions.get(version_id)
    if not v:
        raise HTTPException(
            status_code=404,
            detail=f"Version {version_id} not found in the synced mirror",
        )
    return v


def _issues_for(version_id: str) -> list:
    tickets = sorted(
        get_mirror().issues_by_version.get(version_id, []),
        key=lambda t: (
            ((t.get("fields") or {}).get("issuetype") or {}).get("name", ""),
            t.get("key", ""),
        ),
    )
    issues = []
    for t in tickets:
        f = t.get("fields") or {}
        issues.append(
            {
                "key": t.get("key", ""),
                "summary": f.get("summary", ""),
                "type": (f.get("issuetype") or {}).get("name", ""),
                "status": (f.get("status") or {}).get("name", ""),
                "priority": (f.get("priority") or {}).get("name", "None") or "None",
                "description": field_text(f, "description"),
                "biz_context": field_text(f, "customfield_12174"),
                "steps_actual_expected": field_text(f, "customfield_12864"),
                "expected_behavior": field_text(f, "customfield_12830"),
            }
        )
    return issues


def _version_info(version_id: str, project: str = "") -> dict:
    v = _version_record(version_id)
    return {
        "id": version_id,
        "name": v["name"],
        "project": project or v["project"],
        "description": v["description"],
        "releaseDate": v["releaseDate"],
    }


# ── Routes ─────────────────────────────────────────────────────────────────────


@router.get("/api/versions")
def api_versions(
    project: str = Query(DEFAULT_PROJECT),
    unreleased: bool = Query(True),
    released: bool = Query(False),
    limit: int = Query(10),
    offset: int = Query(0),
):
    if project != "ALL":
        validate_project(project)
    all_items = get_versions(project, unreleased, released)
    return {
        "items": all_items[offset : offset + limit],
        "total": len(all_items),
        "hasMore": offset + limit < len(all_items),
    }


@router.get("/api/version/{version_id}")
def api_version(version_id: str):
    validate_numeric_id(version_id, "version_id")
    config = load_config()
    v = _version_record(version_id)
    issues = _issues_for(version_id)
    return {
        "id": version_id,
        "name": v["name"],
        "project": v["project"],
        "description": v["description"],
        "startDate": v["startDate"],
        "releaseDate": v["releaseDate"],
        "released": v["released"],
        "driver": None,
        "jiraUrl": config.get("JIRA_URL", "").rstrip("/"),
        "issues": issues,
        "issueCount": len(issues),
    }


class GenerateRequest(BaseModel):
    version_id: str
    project: Optional[str] = ""
    sizes: Optional[dict] = {}


class RegenerateRequest(BaseModel):
    version_id: str
    project: Optional[str] = ""
    section: str  # "short" | "full" | "biz"
    current: str  # current text of that section
    instruction: Optional[str] = ""


@router.post("/api/preview-prompt")
def api_preview_prompt(req: GenerateRequest):
    validate_numeric_id(req.version_id, "version_id")
    try:
        version_info = _version_info(req.version_id, req.project)
        issues = _issues_for(req.version_id)
        return {"prompt": build_prompt(version_info, issues, req.sizes)}
    except HTTPException:
        raise
    except Exception:
        log.exception("Error building preview prompt for version %s", req.version_id)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/api/generate")
def api_generate(req: GenerateRequest):
    validate_numeric_id(req.version_id, "version_id")
    config = load_config()
    try:
        version_info = _version_info(req.version_id, req.project)
        issues = _issues_for(req.version_id)
        result = generate_with_ai(config, version_info, issues, req.sizes)
        result["issueCount"] = len(issues)
        return result
    except HTTPException:
        raise
    except Exception:
        log.exception("Error generating release notes for version %s", req.version_id)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/api/regenerate-section")
def api_regenerate_section(req: RegenerateRequest):
    validate_numeric_id(req.version_id, "version_id")
    config = load_config()
    try:
        version_info = _version_info(req.version_id, req.project)
        issues = _issues_for(req.version_id)
        text = regenerate_section(
            config,
            version_info,
            issues,
            req.section,
            req.current,
            req.instruction or "",
        )
        return {"text": text}
    except HTTPException:
        raise
    except Exception:
        log.exception("Error regenerating section for version %s", req.version_id)
        raise HTTPException(status_code=500, detail="Internal server error")
