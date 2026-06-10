#!/usr/bin/env python3
"""
Cadence — Scrum Master Toolbox

Dev:
    uvicorn server:app --port 8765 --reload

Prod (after `cd frontend && npm run build`):
    uvicorn server:app --port 8765
Then open: http://localhost:8765
"""

import hashlib
import hmac
import os
import secrets
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import mirror
from config import TOOLS, ALLOWED_ORIGINS, JIRA_URL, PROJECTS, AUTH_USER, AUTH_PASSWORD, SESSION_SECRET
from tools.release_notes.router import router as rn_router
from tools.sprint_summary.router import router as ss_router
from tools.sync.router import router as sync_router
from tools.ask.router import router as ask_router
from tools.planner.router import router as planner_router
from tools.flow_metrics.router import router as fm_router

app = FastAPI(title="Cadence")

# ── Authentication ─────────────────────────────────────────────────────────────
# Cookie-session login, active only when both env vars are set (see config.py).
# Unset = disabled, which is the local-dev default — nothing breaks until you
# opt in. The SPA shell and static assets stay public so the login page can
# render; every data route (/api/* plus the tool routers and API docs) needs
# the session cookie. POST /api/login issues it — the token is an HMAC-signed
# expiry stamp, so there is no server-side session store.
#
# Middleware runs outermost-first in reverse registration order: CORS → auth →
# routes. CORS being outermost means a 401 from auth still carries the
# Access-Control-Allow-Origin header, so cross-origin (dev) clients see the
# real status instead of a CORS error.

_AUTH_ENABLED = bool(AUTH_USER and AUTH_PASSWORD)
_SESSION_COOKIE = "cadence_session"
_SESSION_TTL = 7 * 24 * 3600   # one login per browser per week

_PROTECTED_PREFIXES = ("/api/", "/release-notes/", "/sprint-summary/", "/sync/",
                       "/ask/", "/planner/", "/flow-metrics/",
                       "/docs", "/openapi.json")
_PUBLIC_PATHS = {"/api/auth", "/api/login"}


def _sign(msg: str) -> str:
    return hmac.new(SESSION_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()


def _make_session_token() -> str:
    expires = str(int(time.time()) + _SESSION_TTL)
    return f"{expires}.{_sign(expires)}"


def _session_ok(token: str) -> bool:
    """Constant-time check of an `expiry.signature` session token."""
    expires, _, sig = token.partition(".")
    if not expires.isdigit() or not sig:
        return False
    if not secrets.compare_digest(sig, _sign(expires)):
        return False
    return int(expires) > time.time()


@app.middleware("http")
async def require_auth(request: Request, call_next):
    path = request.url.path
    # OPTIONS carries no credentials; skip it so CORS preflight still works.
    needs_auth = (_AUTH_ENABLED
                  and request.method != "OPTIONS"
                  and path not in _PUBLIC_PATHS
                  and path.startswith(_PROTECTED_PREFIXES))
    if needs_auth and not _session_ok(request.cookies.get(_SESSION_COOKIE, "")):
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["http://localhost:5173", "http://localhost:8765"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── App-level API ───────────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    username: str = ""
    password: str = ""


@app.get("/api/auth")
def api_auth(request: Request):
    """Login state for the frontend boot: whether a login is required, and
    whether this browser already holds a valid session."""
    authed = (not _AUTH_ENABLED) or _session_ok(request.cookies.get(_SESSION_COOKIE, ""))
    return {"required": _AUTH_ENABLED, "authenticated": authed}


@app.post("/api/login")
def api_login(body: LoginBody):
    if not _AUTH_ENABLED:
        return {"ok": True}
    ok = (secrets.compare_digest(body.username, AUTH_USER)
          and secrets.compare_digest(body.password, AUTH_PASSWORD))
    if not ok:
        return JSONResponse({"detail": "Wrong username or password"}, status_code=401)
    resp = JSONResponse({"ok": True})
    resp.set_cookie(_SESSION_COOKIE, _make_session_token(),
                    max_age=_SESSION_TTL, httponly=True, samesite="lax", path="/")
    return resp


@app.post("/api/logout")
def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(_SESSION_COOKIE, path="/")
    return resp


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
app.include_router(ss_router,      prefix="/sprint-summary")
app.include_router(sync_router,  prefix="/sync")
app.include_router(ask_router,     prefix="/ask")
app.include_router(planner_router, prefix="/planner")
app.include_router(fm_router,      prefix="/flow-metrics")

# ── Frontend (SPA) — served after `npm run build` ──────────────────────────────
_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_DIST):
    # Serve Vite build — SPA fallback handled by html=True
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="spa")
