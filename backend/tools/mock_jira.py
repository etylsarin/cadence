#!/usr/bin/env python3
"""
mock_jira.py — Offline Jira API stand-in for the Sync pipeline.

All tools read exclusively from the synced local mirror, so the only Jira
consumer left is the Sync pipeline (backend/tools/sync/_gettickets.sh). This
server provides exactly the two endpoints it calls, backed by a deterministic
ticket corpus generated in-memory at startup by seed_demo_data.generate()
(includes Epics, open backlog, sprints, fix versions — no data/ needed).

Usage:
    python3 -m uvicorn tools.mock_jira:app --app-dir backend --port 9876
    # .env:  JIRA_URL=http://localhost:9876

Covered endpoints:
    POST /rest/api/3/search/jql          discovery query, paginated:
                                         project in (…) AND issuetype in (…)
                                         AND created >= "date" ORDER BY created ASC
    GET  /rest/api/3/issue/{key}         full raw issue (?expand=changelog)

With this running, `cd backend/tools/sync && ./pipeline.py` rebuilds
bronze/silver/gold from scratch — which is what every tool runs on.
"""

import re
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from tools.seed_demo_data import generate

app = FastAPI(title="Mock Jira (generated corpus)")

_tickets = sorted(generate(), key=lambda t: t.get("key", ""))
_by_key = {t.get("key", ""): t for t in _tickets}

print(f"mock_jira: serving {len(_tickets)} generated issues "
      f"({sum(1 for t in _tickets if t['fields']['issuetype']['name'] == 'Epic')} epics)")

_DISCOVERY_RE = re.compile(
    r'project\s+in\s*\(([^)]*)\)\s+AND\s+issuetype\s+in\s*\(([^)]*)\)'
    r'\s+AND\s+created\s*>=\s*"([^"]+)"',
    re.IGNORECASE,
)


def _run_jql(jql: str) -> list:
    m = _DISCOVERY_RE.search(jql or "")
    if not m:
        raise HTTPException(status_code=400, detail=f"mock_jira: unsupported JQL: {jql!r}")
    projects = {p.strip().strip('"') for p in m.group(1).split(",") if p.strip()}
    types    = {t.strip().strip('"') for t in m.group(2).split(",") if t.strip()}
    since    = m.group(3)
    out = []
    for t in _tickets:
        f = t.get("fields", {})
        if ((f.get("project") or {}).get("key", "") in projects
                and (f.get("issuetype") or {}).get("name", "") in types
                and f.get("created", "")[:10] >= since):
            out.append({"key": t.get("key", ""),
                        "fields": {"created": f.get("created", ""),
                                   "updated": f.get("updated", "")}})
    out.sort(key=lambda i: i["fields"]["created"])      # ORDER BY created ASC
    return out


class JqlSearch(BaseModel):
    jql: str
    maxResults: int = 100
    fields: list = []
    nextPageToken: Optional[str] = None


@app.post("/rest/api/3/search/jql")
def search_jql(body: JqlSearch):
    issues = _run_jql(body.jql)
    # Real-Jira pagination: maxResults per page, opaque nextPageToken (offset).
    start = int(body.nextPageToken) if body.nextPageToken else 0
    page_size = max(1, body.maxResults)
    page = issues[start:start + page_size]
    out = {"issues": page}
    if start + page_size < len(issues):
        out["nextPageToken"] = str(start + page_size)
    else:
        out["isLast"] = True
    return out


@app.get("/rest/api/3/issue/{key}")
def issue_detail(key: str, expand: str = ""):
    """Full raw issue (fields + changelog) — what _gettickets.sh downloads."""
    t = _by_key.get(key)
    if not t:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found")
    return t
