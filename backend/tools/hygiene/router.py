"""Ticket Hygiene Auditor — FastAPI router.

All routes are mounted under the /hygiene prefix by server.py.

Data source: the synced local mirror (backend/mirror.py over data/silver/).
Scans every ticket of a project against hygiene rules and reports the
violations that silently corrupt downstream metrics (velocity, flow,
release notes). Only the optional AI fix-plan step leaves the machine.

Rules
-----
missing_points   Started Stories without a story-point estimate — they are
                 invisible to velocity and any points-based metric.
no_epic          Stories/Tasks/Spikes with no epic link — orphans that no
                 roadmap or epic-level rollup can see.
retro_fix_version  Tickets tagged with a version that was released before
                 the ticket was created or completed. The silver changelog
                 only carries status history (not fixVersion changes), so
                 this is the detectable subset of retro-tagging: a tag that
                 cannot have been applied before the release shipped.
status_loops     Rework ping-pong — the ticket re-entered statuses it had
                 already visited at least LOOP_THRESHOLD times, which skews
                 every time-in-status number.
stale_wip        Started work that hasn't moved in STALE_DAYS — either
                 abandoned or silently blocked; it inflates aging and WIP.
"""

from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import ai as _ai
from config import PROJECTS, load_config, validate_project
from mirror import TERMINAL_STATUSES, get_mirror, status_transitions

# Default project for query params — first key from config.env PROJECTS.
DEFAULT_PROJECT = PROJECTS[0] if PROJECTS else ""

router = APIRouter()
log = logging.getLogger(__name__)

# Status→stage map: user-saved gold config, else the default shipped with the
# Sync pipeline. Loaded directly from disk so this tool stays self-contained
# (no import from another tool's module).
_DATA_DIR            = os.path.join(os.path.dirname(__file__), "../../data/gold")
_FLOW_CONFIG_PATH    = os.path.join(_DATA_DIR, "flow_config.json")
_FLOW_DEFAULT_PATH   = os.path.join(os.path.dirname(__file__), "../sync/flow_config_default.json")

# Stages where work is underway or queued mid-flow (everything between
# backlog and done) — the same split the flow-metrics gold uses.
CYCLE_STAGES = {"dev", "testing", "sit", "uat",
                "wait_testing", "wait_sit", "wait_uat", "wait_release"}


def _load_stage_map() -> dict:
    """Shipped default overlaid with the user-saved gold config, so a partial
    or hand-edited save can't silently unmap statuses the default covers."""
    merged: dict = {}
    for path in (_FLOW_DEFAULT_PATH, _FLOW_CONFIG_PATH):
        try:
            with open(path) as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            merged.update(data)
    return merged

EPIC_LINK_FIELD = "customfield_10008"
POINTS_FIELD    = "customfield_10005"

LOOP_THRESHOLD   = 2    # re-entries into already-visited statuses before flagging
STALE_DAYS       = 14   # days without a status change before started work is stale
RETRO_GRACE_DAYS = 3    # closing tickets shortly after a release is normal admin lag

EPIC_TYPES   = {"Story", "Task", "Spike"}   # types expected to belong to an epic
POINTS_TYPES = {"Story"}                    # types expected to carry an estimate

# Abandoned work never feeds velocity, so a missing estimate there is noise.
ABANDONED_STATUSES = {"Cancelled", "Rejected", "Won't Do"}

RULES = [
    ("missing_points",    "Missing estimates",
     "Started Stories without story points — invisible to velocity and points-based metrics."),
    ("no_epic",           "No epic link",
     "Stories, Tasks and Spikes outside any epic — invisible to roadmap and epic rollups."),
    ("retro_fix_version", "Suspect fix version",
     "Tagged with a version released before the ticket was created or completed — the tag cannot predate the release."),
    ("status_loops",      "Status ping-pong",
     f"Re-entered already-visited statuses {LOOP_THRESHOLD}+ times — rework loops that skew time-in-status metrics."),
    ("stale_wip",         "Stale in-progress",
     f"Started work without a status change for {STALE_DAYS}+ days — abandoned or silently blocked."),
]


def _parse_ts(s: str) -> Optional[datetime]:
    """Parse a Jira timestamp ('2026-02-16T03:50:42.000+0000'), UTC-aware."""
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


# ── Rule checks — each returns a violation detail string, or None ──────────────

def _points(raw) -> Optional[float]:
    """Story points tolerating numeric strings; None for absent/garbage."""
    try:
        return float(raw) if raw is not None and raw != "" else None
    except (TypeError, ValueError):
        return None


def _check_missing_points(f: dict, stage: str) -> Optional[str]:
    itype = ((f.get("issuetype") or {}).get("name", "") or "")
    if itype not in POINTS_TYPES or stage in ("", "pre_work"):
        return None   # backlog items may legitimately be unestimated
    status = ((f.get("status") or {}).get("name", "") or "")
    if status in ABANDONED_STATUSES:
        return None   # cancelled work never feeds velocity
    if _points(f.get(POINTS_FIELD)) is not None:
        return None
    return f"No story points; already in '{status}'"


def _check_no_epic(t: dict, f: dict) -> Optional[str]:
    itype = ((f.get("issuetype") or {}).get("name", "") or "")
    if itype not in EPIC_TYPES:
        return None
    if f.get(EPIC_LINK_FIELD) or ((f.get("parent") or {}).get("key", "")):
        return None
    return "Not linked to any epic"


def _check_retro_fix_version(f: dict, done_dt: Optional[datetime]) -> Optional[str]:
    created = (f.get("created", "") or "")[:10]
    done = done_dt.strftime("%Y-%m-%d") if done_dt else ""
    for v in f.get("fixVersions") or []:
        if not v.get("released"):
            continue
        rd = (v.get("releaseDate", "") or "")[:10]
        if not rd:
            continue
        # Grace window: closing tickets in the days after a release is normal
        # admin lag (and absorbs the bare-date vs timezone-offset edge), so
        # only completions clearly past the release are suspect.
        try:
            grace_end = (datetime.strptime(rd, "%Y-%m-%d") + timedelta(days=RETRO_GRACE_DAYS)).strftime("%Y-%m-%d")
        except ValueError:
            continue
        if created > rd:
            return f"Created {created}, after '{v.get('name', '?')}' released {rd}"
        if done and done > grace_end:
            return f"Completed {done}, after '{v.get('name', '?')}' released {rd}"
    return None


def _check_status_loops(trans: list) -> Optional[str]:
    visited: set = set()
    reentries: dict = defaultdict(int)
    if trans:
        visited.add(trans[0][1])   # status before the first transition
    for _ts, _frm, to in trans:
        if to in visited:
            reentries[to] += 1
        visited.add(to)
    total = sum(reentries.values())
    if total < LOOP_THRESHOLD:
        return None
    worst = max(reentries, key=lambda s: reentries[s])
    return f"{total} status re-entries (worst: '{worst}' ×{reentries[worst]})"


def _check_stale_wip(f: dict, stage: str, trans: list, now: datetime) -> Optional[str]:
    status = ((f.get("status") or {}).get("name", "") or "")
    if status in TERMINAL_STATUSES or stage not in CYCLE_STAGES:
        return None
    entered = _parse_ts(trans[-1][0]) if trans else _parse_ts(f.get("created", ""))
    if not entered:
        return None
    days = (now - entered).total_seconds() / 86400
    if days < STALE_DAYS:
        return None
    return f"In '{status}' for {days:.0f} days"


# ── Audit ──────────────────────────────────────────────────────────────────────

def _first_terminal_dt(trans: list) -> Optional[datetime]:
    for ts, _frm, to in trans:
        if to in TERMINAL_STATUSES:
            return _parse_ts(ts)
    return None


def run_audit(project: str) -> dict:
    stage_map = _load_stage_map()
    now = datetime.now(timezone.utc)

    items_by_rule: dict = {rule_id: [] for rule_id, _l, _d in RULES}
    scanned = 0
    dirty_keys: set = set()

    for t in get_mirror().tickets:
        f = t.get("fields") or {}
        key = t.get("key", "")
        if ((f.get("project") or {}).get("key", "")) != project:
            continue
        itype = ((f.get("issuetype") or {}).get("name", "") or "")
        if itype == "Epic":
            continue   # rules below are about work items, not containers
        scanned += 1

        status = ((f.get("status") or {}).get("name", "") or "")
        stage = stage_map.get(status, "")
        trans = status_transitions(t)
        done_dt = _first_terminal_dt(trans)

        findings = {
            "missing_points":    _check_missing_points(f, stage),
            "no_epic":           _check_no_epic(t, f),
            "retro_fix_version": _check_retro_fix_version(f, done_dt),
            "status_loops":      _check_status_loops(trans),
            "stale_wip":         _check_stale_wip(f, stage, trans, now),
        }
        for rule_id, detail in findings.items():
            if detail is None:
                continue
            dirty_keys.add(key)
            items_by_rule[rule_id].append({
                "key":     key,
                "type":    itype,
                "status":  status,
                "summary": f.get("summary", "") or "",
                "points":  _points(f.get(POINTS_FIELD)),
                "detail":  detail,
            })

    def _natural_key(item: dict) -> tuple:
        prefix, _, num = item["key"].partition("-")
        return (prefix, int(num) if num.isdigit() else 0)

    for items in items_by_rule.values():
        items.sort(key=_natural_key)

    return {
        "scanned":    scanned,
        "dirty":      len(dirty_keys),
        "clean":      scanned - len(dirty_keys),
        "violations": sum(len(v) for v in items_by_rule.values()),
        "rules": [
            {"id": rule_id, "label": label, "description": desc,
             "count": len(items_by_rule[rule_id]), "items": items_by_rule[rule_id]}
            for rule_id, label, desc in RULES
        ],
        "jira_url": load_config().get("JIRA_URL", "").rstrip("/"),
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/api/audit")
def api_audit(project: str = Query(DEFAULT_PROJECT)):
    """Run every hygiene rule over the project's mirrored tickets."""
    validate_project(project)
    try:
        return run_audit(project)
    except Exception:
        log.exception("Error running hygiene audit for %s", project)
        raise HTTPException(status_code=500, detail="Internal server error")


class SuggestRequest(BaseModel):
    project: str


_SUGGEST_SYSTEM = (
    "You are a pragmatic agile delivery coach helping a Scrum Master clean up "
    "their Jira project. You receive a hygiene audit: rule violations found in "
    "the team's tickets. Draft a concise, actionable fix plan in markdown: "
    "prioritise by metric impact, group fixes that can be done in bulk, name "
    "the Jira mechanics to use (bulk edit, JQL filters, board settings), and "
    "suggest one working agreement per recurring cause so the violations stop "
    "reappearing. Be specific to the data you were given; no generic advice."
)

_MAX_KEYS_PER_RULE = 20


@router.post("/api/suggest")
def api_suggest(req: SuggestRequest):
    """Draft an AI fix plan from the audit findings. The audit is recomputed
    server-side; only this endpoint sends data to the AI provider."""
    validate_project(req.project)
    try:
        audit = run_audit(req.project)
        lines = [f"Project {req.project}: {audit['scanned']} tickets scanned, "
                 f"{audit['violations']} violations across {audit['dirty']} tickets."]
        for rule in audit["rules"]:
            if not rule["count"]:
                continue
            lines.append(f"\n## {rule['label']} ({rule['count']})")
            lines.append(rule["description"])
            for i in rule["items"][:_MAX_KEYS_PER_RULE]:
                lines.append(f"- {i['key']} [{i['type']}, {i['status']}] {i['detail']}")
            if rule["count"] > _MAX_KEYS_PER_RULE:
                lines.append(f"- … and {rule['count'] - _MAX_KEYS_PER_RULE} more")
        if audit["violations"] == 0:
            return {"suggestions": "No violations found — nothing to fix. 🎉"}
    except Exception:
        log.exception("Error building hygiene suggestion prompt for %s", req.project)
        raise HTTPException(status_code=500, detail="Internal server error")

    try:
        text = _ai.complete(
            load_config(),
            [{"role": "user", "content": "\n".join(lines)}],
            system=_SUGGEST_SYSTEM,
            max_tokens=1500,
        )
    except ValueError as e:
        # ai.py raises ValueError when no AI API key is configured.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        log.exception("Error drafting hygiene suggestions for %s", req.project)
        raise HTTPException(status_code=500, detail="Internal server error")
    return {"suggestions": text}
