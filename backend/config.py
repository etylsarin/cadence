"""Shared configuration for Cadence.

Non-secret app config is read from config.env (committed, root).
Secrets are read from .env (gitignored, root) or environment variables.
In production, secrets are injected as environment variables.
"""

import os
import re as _re
import secrets as _secrets
from pathlib import Path

# Config files (config.env, .env) live at the repo root, one level above backend/.
_ROOT = Path(__file__).resolve().parent.parent


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_env_file(path: Path) -> dict:
    """Parse a .env-style file.

    Lines ending with [] (e.g. TOOLS[]=foo) are collected into a list
    under the bare key (e.g. "TOOLS").  All other lines are scalar strings.
    """
    result = {}
    if not path.exists():
        return result
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"')
            if k.endswith("[]"):
                bare = k[:-2]
                result.setdefault(bare, []).append(v)
            else:
                result[k] = v
    return result


# ── Non-secret app config (config.env) ───────────────────────────────────────

_app_cfg = _parse_env_file(_ROOT / "config.env")

PROJECTS           = [p.strip() for p in _app_cfg.get("PROJECTS", "").split(",") if p.strip()]
SYNC_ISSUE_TYPES = _app_cfg.get("SYNC_ISSUE_TYPES", "Story,Spike,Bug,Task,Epic")
SYNC_START_DATE  = _app_cfg.get("SYNC_START_DATE", "2024-01-01")


def _parse_tools(cfg: dict) -> list:
    """Parse TOOLS[] entries (id|Name|description) into tool dicts.

    The description is optional and is the single source of truth for the
    homepage card text. Split is capped at 2 pipes so a description may itself
    contain '|' without breaking parsing. Homepage order follows list order.
    """
    tools = []
    for entry in cfg.get("TOOLS", []):
        parts = [p.strip() for p in entry.split("|", 2)]
        if len(parts) >= 2:
            tools.append({
                "id":   parts[0],
                "name": parts[1],
                "desc": parts[2] if len(parts) > 2 else "",
            })
    return tools


TOOLS = _parse_tools(_app_cfg)

_local_env = _parse_env_file(_ROOT / ".env")

# Non-secret Jira base URL — readable from config.env, env var, or .env as fallback.
JIRA_URL = _app_cfg.get("JIRA_URL") or os.environ.get("JIRA_URL") or _local_env.get("JIRA_URL", "")

# CORS allowed origins — comma-separated list in config.env.
ALLOWED_ORIGINS = [o.strip() for o in _app_cfg.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]

# ── App authentication (login page, optional) ─────────────────────────────────
# Secrets — read from env vars (production) or .env (local). When BOTH
# user and password are set, the app requires a login (see server.py). When
# unset, auth is disabled — the local-dev default, so nothing breaks until you
# opt in by setting these in production.
AUTH_USER     = os.environ.get("CADENCE_AUTH_USER")     or _local_env.get("CADENCE_AUTH_USER", "")
AUTH_PASSWORD = os.environ.get("CADENCE_AUTH_PASSWORD") or _local_env.get("CADENCE_AUTH_PASSWORD", "")

# Session-cookie signing secret. Set it to keep logins valid across server
# restarts; when unset a fresh secret is generated at boot (every restart
# signs everyone out).
SESSION_SECRET = (os.environ.get("CADENCE_SESSION_SECRET")
                  or _local_env.get("CADENCE_SESSION_SECRET", "")
                  or _secrets.token_hex(32))


# ── Input validators ──────────────────────────────────────────────────────────

def validate_numeric_id(value: str, name: str = "id") -> str:
    """Raise HTTP 400 if value is not a plain integer string (Jira version/sprint ID)."""
    from fastapi import HTTPException
    if not _re.fullmatch(r"\d+", str(value)):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


def validate_project(value: str) -> str:
    """Raise HTTP 400 if value is not a known project key."""
    from fastapi import HTTPException
    if value not in PROJECTS:
        raise HTTPException(status_code=400, detail=f"Unknown project: {value!r}")
    return value


# ── Secrets (.env or environment variables) ───────────────────────────────────

def load_config() -> dict:
    """Load secrets from .env (local dev) or environment variables (production)."""
    env = _parse_env_file(_ROOT / ".env")

    def _get(key: str) -> str:
        return os.environ.get(key) or env.get(key, "")

    return {
        "JIRA_URL":          _get("JIRA_URL"),
        "JIRA_EMAIL":        _get("JIRA_EMAIL"),
        "API_TOKEN":         _get("JIRA_API_TOKEN"),
        "ANTHROPIC_API_KEY": _get("ANTHROPIC_API_KEY"),
        "OPENAI_API_KEY":    _get("OPENAI_API_KEY"),
        "AI_PROVIDER":       _get("AI_PROVIDER"),   # "anthropic" | "openai" (auto-detected if blank)
        "AI_MODEL":          _get("AI_MODEL"),       # overrides per-provider default if set
    }
