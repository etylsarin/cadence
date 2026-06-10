#!/usr/bin/env python3
"""
Cadence — Scrum Master Toolbox

Dev:
    uvicorn server:app --port 8765 --reload

Prod (after `cd frontend && npm run build`):
    uvicorn server:app --port 8765
Then open: http://localhost:8765
"""

import base64
import binascii
import os
import secrets

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

import mirror
from config import TOOLS, ALLOWED_ORIGINS, JIRA_URL, PROJECTS, AUTH_USER, AUTH_PASSWORD
from tools.release_notes.router import router as rn_router
from tools.sync.router import router as sync_router
from tools.ask.router import router as ask_router

app = FastAPI(title="Cadence")

# ── Authentication ─────────────────────────────────────────────────────────────
# Middleware runs outermost-first in reverse registration order: CORS → auth →
# routes. CORS being outermost means a 401 from auth still carries the
# Access-Control-Allow-Origin header, so cross-origin (dev) clients see the
# real status instead of a CORS error.

# HTTP Basic auth, active only when both env vars are set (see config.py).
# Unset = disabled, which is the local-dev default — nothing breaks until you opt in.
_AUTH_ENABLED = bool(AUTH_USER and AUTH_PASSWORD)


def _basic_auth_ok(header: str) -> bool:
    """Constant-time check of an `Authorization: Basic` header against config creds."""
    scheme, _, encoded = header.partition(" ")
    if scheme.lower() != "basic" or not encoded:
        return False
    try:
        user, _, pw = base64.b64decode(encoded).decode("utf-8").partition(":")
    except (binascii.Error, UnicodeDecodeError):
        return False
    return (secrets.compare_digest(user, AUTH_USER)
            and secrets.compare_digest(pw, AUTH_PASSWORD))


@app.middleware("http")
async def require_auth(request: Request, call_next):
    # OPTIONS carries no credentials; skip it so CORS preflight still works.
    if _AUTH_ENABLED and request.method != "OPTIONS":
        if not _basic_auth_ok(request.headers.get("Authorization", "")):
            return PlainTextResponse(
                "Unauthorized", status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Cadence"'},
            )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["http://localhost:5173", "http://localhost:8765"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── App-level API ───────────────────────────────────────────────────────────────

@app.get("/api/config")
def api_config():
    """Expose non-secret client configuration (Jira base URL for link
    generation, project keys for squad lists and colors)."""
    return {"jira_url": JIRA_URL, "projects": PROJECTS}


@app.get("/api/tools")
def api_tools():
    """Homepage tools (registry order) plus the sync state. Every tool except
    Sync Now works off the synced mirror, so the homepage disables them and
    shows an alert until the first sync completes."""
    return {
        "tools": TOOLS,
        "sync": {"synced": mirror.is_synced(), "last_sync": mirror.last_sync()},
    }


@app.get("/api/accessible-tools")
def api_accessible_tools():
    """Navigable tools for the frontend route guard. Until the first sync,
    only Sync Now is navigable — everything else reads the synced mirror."""
    if mirror.is_synced():
        return TOOLS
    return [t for t in TOOLS if t["id"] == "sync"]


# ── API routers ─────────────────────────────────────────────────────────────────
app.include_router(rn_router,      prefix="/release-notes")
app.include_router(sync_router,  prefix="/sync")
app.include_router(ask_router,     prefix="/ask")

# ── Frontend (SPA) — served after `npm run build` ──────────────────────────────
_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_DIST):
    # Serve Vite build — SPA fallback handled by html=True
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="spa")
