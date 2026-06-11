"""Flow Metrics — FastAPI router.

All routes are mounted under the /flow-metrics prefix by server.py.

Data sources:
  • Completed flow: data/gold/flow_metrics.csv (per-issue days in each Jira
    status, produced by Sync) aggregated into workflow stages through the
    status→stage map (flow_shared.load_flow_config).
  • Aging WIP: the synced local mirror (backend/mirror.py) — open tickets with
    their time in current status replayed from changelogs.
No live Jira calls.

Stage semantics
---------------
Statuses map to ordered stages (flow_config). Per issue:
    cycle time = days in active + wait stages (work started → done)
    lead  time = pre_work + cycle time      (created → done)
post_work days are excluded everywhere: the gold transformation accumulates
open-ended time in the final status, which would otherwise grow with every
sync. Statuses with no stage assigned ("") are excluded from aggregation,
matching the Sync transformation's documented behaviour.

Known limitation: an issue that reached a terminal status once (so it's in
the gold) but was later reopened and is still open has a non-post_work final
status, so its open-ended tail leaks into that stage's days. Fixing that
belongs in the Sync transformation (stop the clock at the first terminal
transition), not here.
"""

from __future__ import annotations

import csv
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from config import PROJECTS, load_config, validate_project
from mirror import TERMINAL_STATUSES, get_mirror, status_transitions
from tools.flow_metrics.flow_shared import get_months, load_flow_config

# Default project for query params — first key from config.env PROJECTS.
DEFAULT_PROJECT = PROJECTS[0] if PROJECTS else ""

router = APIRouter()
log = logging.getLogger(__name__)

_GOLD_CSV = os.path.join(os.path.dirname(__file__), "../../data/gold/flow_metrics.csv")

# Canonical stage order (the workflow left to right) with display labels.
STAGES = [
    ("pre_work",     "Pre-work",         "queue"),
    ("dev",          "Development",      "active"),
    ("wait_testing", "Wait for Testing", "wait"),
    ("testing",      "Testing",          "active"),
    ("wait_sit",     "Wait for SIT",     "wait"),
    ("sit",          "SIT",              "active"),
    ("wait_uat",     "Wait for UAT",     "wait"),
    ("uat",          "UAT",              "active"),
    ("wait_release", "Wait for Release", "wait"),
]
ACTIVE_STAGES = {s for s, _, k in STAGES if k == "active"}
WAIT_STAGES   = {s for s, _, k in STAGES if k == "wait"}
CYCLE_STAGES  = ACTIVE_STAGES | WAIT_STAGES

FLOW_TYPES = ["Story", "Bug"]   # the types the gold transformation includes


# ── Gold CSV loading (cached by mtime) ─────────────────────────────────────────

_rows_cache: tuple = (None, [], [])   # (mtime_ns, rows, status_cols)


def _load_rows() -> tuple[list[dict], list[str]]:
    """flow_metrics.csv rows + the status column names (headers after 'transitions')."""
    global _rows_cache
    try:
        mtime = os.stat(_GOLD_CSV).st_mtime_ns
    except OSError:
        return [], []
    # Single read of the mutable global so a concurrent refresh can't pair
    # rows from one CSV snapshot with status columns from another.
    cached = _rows_cache
    if cached[0] != mtime:
        rows: list[dict] = []
        status_cols: list[str] = []
        with open(_GOLD_CSV, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames or []
            if "transitions" in headers:
                status_cols = headers[headers.index("transitions") + 1:]
            rows = list(reader)
        cached = (mtime, rows, status_cols)
        _rows_cache = cached
    return cached[1], cached[2]


# ── Math helpers ───────────────────────────────────────────────────────────────

def _percentile(values: list[float], p: float) -> Optional[float]:
    """Linear-interpolated percentile; None for an empty list."""
    if not values:
        return None
    vs = sorted(values)
    if len(vs) == 1:
        return vs[0]
    idx = (len(vs) - 1) * p
    lo, hi = int(idx), min(int(idx) + 1, len(vs) - 1)
    return vs[lo] + (vs[hi] - vs[lo]) * (idx - lo)


def _r1(v) -> Optional[float]:
    return None if v is None else round(v, 1)


def _safe_float(raw) -> Optional[float]:
    """float(raw) tolerating None/garbage/NaN — one bad field must not 500 a route."""
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return None if v != v else v   # v != v ⇔ NaN


def _stats(values: list[float]) -> dict:
    return {
        "avg": _r1(sum(values) / len(values)) if values else None,
        "p50": _r1(_percentile(values, 0.50)),
        "p85": _r1(_percentile(values, 0.85)),
    }


# ── Per-issue stage aggregation ────────────────────────────────────────────────

def _issue_stage_days(row: dict, status_cols: list[str], stage_map: dict) -> dict:
    """{stage: days} for one CSV row, summing its status columns per stage."""
    days: dict = defaultdict(float)
    for col in status_cols:
        v = row.get(col, "")
        if not v:
            continue
        stage = stage_map.get(col, "")
        if not stage or stage == "post_work":
            continue
        d = _safe_float(v)
        if d is not None:
            days[stage] += d
    return days


def _build_issues(project: str, months: set, types: list[str]) -> list[dict]:
    """Completed issues for project/months/types with per-stage day totals."""
    rows, status_cols = _load_rows()
    stage_map = load_flow_config()
    out: list[dict] = []
    for r in rows:
        if project != "ALL" and r.get("project") != project:
            continue
        if r.get("query") not in months:
            continue
        if types and r.get("type") not in types:
            continue
        stage_days = _issue_stage_days(r, status_cols, stage_map)
        active = sum(d for s, d in stage_days.items() if s in ACTIVE_STAGES)
        wait   = sum(d for s, d in stage_days.items() if s in WAIT_STAGES)
        cycle  = active + wait
        lead   = cycle + stage_days.get("pre_work", 0.0)
        out.append({
            "key":      r.get("issue", ""),
            "type":     r.get("type", ""),
            "points":   _safe_float(r.get("story_points") or None),
            "priority": r.get("priority", ""),
            "month":    r.get("query", ""),
            "lead":     round(lead, 1),
            "cycle":    round(cycle, 1),
            "active":   round(active, 1),
            "wait":     round(wait, 1),
            "stages":   {s: round(d, 1) for s, d in stage_days.items()},
        })
    out.sort(key=lambda i: (i["month"], i["key"]))
    return out


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/api/date-range")
def api_date_range():
    """Earliest/latest completion month covered by the flow gold — used by
    timeframe pickers to offer the full depth of history."""
    try:
        rows, _cols = _load_rows()
        months = sorted({r.get("query", "") for r in rows if r.get("query")})
        if not months:
            return {"start_date": None, "end_date": None}
        return {"start_date": f"{months[0]}-01", "end_date": f"{months[-1]}-01"}
    except Exception:
        log.exception("Error reading flow date range")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/flow")
def api_flow(
    project: str       = Query(DEFAULT_PROJECT),
    gran:    str       = Query("M"),
    years:   List[int] = Query(default=[]),
    periods: List[str] = Query(default=[]),
    types:   List[str] = Query(default=FLOW_TYPES),
):
    """Flow summary for completed issues in the selected timeframe: cycle/lead
    time percentiles, flow efficiency, per-stage breakdown, monthly trend and
    the per-issue rows behind them (for drill tables)."""
    if project != "ALL":
        validate_project(project)
    if gran not in ("Y", "Q", "M"):
        raise HTTPException(status_code=400, detail=f"Invalid gran: {gran!r}")
    months = get_months(gran, years, periods)
    try:
        issues = _build_issues(project, months, types)

        cycles = [i["cycle"] for i in issues]
        leads  = [i["lead"] for i in issues]
        active_total = sum(i["active"] for i in issues)
        cycle_total  = sum(cycles)
        lead_total   = sum(leads)

        stages = []
        for stage, label, kind in STAGES:
            vals = [i["stages"].get(stage, 0.0) for i in issues]
            total = sum(vals)
            stages.append({
                "stage": stage,
                "label": label,
                "kind":  kind,
                **_stats(vals),
                "share": round(total / lead_total, 3) if lead_total else 0.0,
            })

        by_month: dict = defaultdict(list)
        for i in issues:
            by_month[i["month"]].append(i["cycle"])
        trend = [
            {
                "month":     m,
                "count":     len(cs),
                "cycle_p50": _r1(_percentile(cs, 0.50)),
                "cycle_p85": _r1(_percentile(cs, 0.85)),
            }
            for m, cs in sorted(by_month.items())
        ]

        return {
            "months_used":     sorted(months),
            "completed":       len(issues),
            "cycle":           _stats(cycles),
            "lead":            _stats(leads),
            "flow_efficiency": round(active_total / cycle_total, 3) if cycle_total else None,
            "stages":          stages,
            "trend":           trend,
            "issues":          issues,
            "jira_url":        load_config().get("JIRA_URL", "").rstrip("/"),
        }
    except Exception:
        log.exception("Error building flow summary for %s", project)
        raise HTTPException(status_code=500, detail="Internal server error")


# ── Aging WIP ──────────────────────────────────────────────────────────────────

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


@router.get("/api/aging")
def api_aging(
    project: str       = Query(DEFAULT_PROJECT),
    types:   List[str] = Query(default=FLOW_TYPES),
):
    """Open started work from the mirror: every non-terminal ticket whose
    current status maps to a cycle stage (work begun, not finished), with its
    age and time in current status. The historic lead-time P85 for the same
    project/types is included as the reference line — age is measured from
    creation, so lead time (created → done) is the like-for-like comparator."""
    if project != "ALL":
        validate_project(project)
    try:
        stage_map = load_flow_config()
        now = datetime.now(timezone.utc)
        items = []
        for t in get_mirror().tickets:
            f = t.get("fields") or {}
            if project != "ALL" and ((f.get("project") or {}).get("key", "")) != project:
                continue
            if ((f.get("issuetype") or {}).get("name", "")) not in types:
                continue
            status = ((f.get("status") or {}).get("name", "") or "")
            if status in TERMINAL_STATUSES:
                continue
            stage = stage_map.get(status, "")
            if stage not in CYCLE_STAGES:
                continue   # backlog (pre_work), finished (post_work) or unmapped
            trans = status_transitions(t)
            created_dt = _parse_ts(f.get("created", ""))
            entered_dt = _parse_ts(trans[-1][0]) if trans else created_dt
            in_status = (now - entered_dt).total_seconds() / 86400 if entered_dt else None
            age       = (now - created_dt).total_seconds() / 86400 if created_dt else None
            items.append({
                "key":            t.get("key", ""),
                "summary":        f.get("summary", "") or "",
                "type":           ((f.get("issuetype") or {}).get("name", "") or ""),
                "status":         status,
                "stage":          stage,
                "points":         _safe_float(f.get("customfield_10005")),
                "in_status_days": _r1(max(in_status, 0.0)) if in_status is not None else None,
                "age_days":       _r1(max(age, 0.0)) if age is not None else None,
            })
        items.sort(key=lambda i: -(i["in_status_days"] or 0.0))

        # Reference: lead-time P85 over the project's full history. Lead, not
        # cycle — item age above is measured from creation, so the comparator
        # must also include pre_work time.
        rows, status_cols = _load_rows()
        leads = []
        for r in rows:
            if project != "ALL" and r.get("project") != project:
                continue
            if types and r.get("type") not in types:
                continue
            sd = _issue_stage_days(r, status_cols, stage_map)
            leads.append(sum(d for s, d in sd.items() if s in CYCLE_STAGES) + sd.get("pre_work", 0.0))

        return {
            "items":    items,
            "lead_p85": _r1(_percentile(leads, 0.85)),
            "jira_url": load_config().get("JIRA_URL", "").rstrip("/"),
        }
    except Exception:
        log.exception("Error building aging WIP for %s", project)
        raise HTTPException(status_code=500, detail="Internal server error")
