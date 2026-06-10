"""mirror.py — in-memory index over the synced local Jira mirror (silver layer).

All tools read Jira data exclusively from here — never from the live Jira
API. The flow is: sync first (backend/tools/sync/pipeline.py), then the
tools work against the mirror.

The index is cached at module level and rebuilt automatically when a sync
completes (signature: last_sync.txt mtime + silver file count).
"""

import json
import threading
from collections import defaultdict
from pathlib import Path
from typing import Optional

_DATA      = Path(__file__).resolve().parent / "data"
_SILVER    = _DATA / "silver"
_LAST_SYNC = _DATA / "last_sync.txt"

TERMINAL_STATUSES = {"Closed", "Done", "Rejected", "Delivered"}


# ── Changelog helpers ─────────────────────────────────────────────────────────

def status_transitions(ticket: dict) -> list:
    """[(iso_ts, from_status, to_status)] sorted chronologically."""
    out = []
    for h in (ticket.get("changelog") or {}).get("histories") or []:
        for item in h.get("items") or []:
            if item.get("field") == "status":
                out.append((h.get("created", ""),
                            item.get("fromString", "") or "",
                            item.get("toString", "") or ""))
    out.sort(key=lambda x: x[0])
    return out


def status_at(ticket: dict, cutoff_iso: str) -> str:
    """The ticket's status as of cutoff_iso, replayed from its changelog."""
    current = ((ticket.get("fields") or {}).get("status") or {}).get("name", "")
    trans = status_transitions(ticket)
    if not trans:
        return current
    cur = trans[0][1] or current        # status before the first transition
    for ts, _frm, to in trans:
        if not cutoff_iso or ts <= cutoff_iso:
            cur = to
    return cur


# ── The index ─────────────────────────────────────────────────────────────────

class Mirror:
    def __init__(self, tickets: list):
        self.tickets = tickets
        self.by_key: dict = {}
        self.versions: dict = {}                       # version id → record
        self.issues_by_version = defaultdict(list)     # version id → [ticket]
        self.sprints: dict = {}                        # sprint id → record (+_tickets)
        self.sprints_by_project = defaultdict(list)    # project → [sprint id]
        self.epics: dict = {}                          # epic key → epic ticket
        self.children_by_epic = defaultdict(list)      # epic key → [ticket]
        self._index()

    def _index(self):
        for t in self.tickets:
            key = t.get("key", "")
            f = t.get("fields") or {}
            self.by_key[key] = t
            project = ((f.get("project") or {}).get("key", "")) or key.split("-")[0]

            if ((f.get("issuetype") or {}).get("name", "")) == "Epic":
                self.epics[key] = t
                continue

            # Epic membership: epic-link custom field or parent (team-managed)
            ek = f.get("customfield_10008") or ((f.get("parent") or {}).get("key", ""))
            if ek:
                self.children_by_epic[ek].append(t)

            for v in f.get("fixVersions") or []:
                vid = str(v.get("id") or "")
                if not vid:
                    continue
                self.issues_by_version[vid].append(t)
                rec = self.versions.get(vid)
                if not rec:
                    rec = self.versions[vid] = {
                        "id":          vid,
                        "name":        v.get("name", vid),
                        "project":     project,
                        "archived":    bool(v.get("archived", False)),
                        "released":    False,
                        "releaseDate": "",
                        "startDate":   "",
                        "description": "",
                    }
                rec["released"] = rec["released"] or bool(v.get("released", False))
                rd = v.get("releaseDate", "") or ""
                if rd > rec["releaseDate"]:
                    rec["releaseDate"] = rd
                created = f.get("created", "")[:10]
                if created and (not rec["startDate"] or created < rec["startDate"]):
                    rec["startDate"] = created

            for sp in f.get("customfield_10007") or []:
                if not isinstance(sp, dict):
                    continue
                sid, name = sp.get("id"), sp.get("name", "")
                if sid is None or not name:
                    continue
                rec = self.sprints.get(sid)
                if not rec:
                    rec = self.sprints[sid] = {
                        "id":           sid,
                        "name":         name,
                        "state":        sp.get("state", ""),
                        "startDate":    sp.get("startDate", ""),
                        "endDate":      sp.get("endDate", ""),
                        "completeDate": sp.get("completeDate", ""),
                        "goal":         sp.get("goal", ""),
                        "_project":     project,
                        "_tickets":     [],
                    }
                rec["_tickets"].append(t)

        for vid, members in self.issues_by_version.items():
            self.versions[vid]["description"] = f"{len(members)} tickets"
        for sid, rec in self.sprints.items():
            self.sprints_by_project[rec["_project"]].append(sid)


# ── Cached accessor ───────────────────────────────────────────────────────────

_lock = threading.Lock()
_cached: Optional[Mirror] = None
_sig: tuple = ()


def _signature() -> tuple:
    try:
        ls = _LAST_SYNC.stat().st_mtime_ns
    except OSError:
        ls = 0
    try:
        n = sum(1 for _ in _SILVER.glob("*.json"))
    except OSError:
        n = 0
    return (ls, n)


def get_mirror() -> Mirror:
    global _cached, _sig
    sig = _signature()
    with _lock:
        if _cached is None or sig != _sig:
            tickets = []
            if _SILVER.is_dir():
                for p in sorted(_SILVER.glob("*.json")):
                    try:
                        tickets.append(json.loads(p.read_text()))
                    except Exception:
                        pass
            _cached = Mirror(tickets)
            _sig = sig
        return _cached


def last_sync() -> Optional[str]:
    try:
        return _LAST_SYNC.read_text().strip() or None
    except OSError:
        return None


def is_synced() -> bool:
    return bool(get_mirror().tickets)
