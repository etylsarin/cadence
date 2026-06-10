# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

```bash
# Run dev mode (Vite HMR on :5173 + FastAPI on :8765)
./run.sh dev

# Run prod mode (build frontend then serve everything on :8765)
./run.sh prod

# Build frontend only
./run.sh build

# Backend only (no frontend)
python3 -m uvicorn server:app --app-dir backend --port 8765 --reload

# Frontend only
cd frontend && npm run dev
```

> `run.sh` hard-codes a local Node path (`$HOME/node-v24.14.0-darwin-arm64/bin`). If that path doesn't exist, edit lines 8–10 to point at your Node installation, or just use `npm`/`npx` directly.

## Sync pipeline

Must be run from the `backend/tools/sync/` directory (uses relative paths internally):

```bash
cd backend/tools/sync
./pipeline.py                 # full pipeline: Jira → bronze → silver → gold
./pipeline.py --silver-only   # recompute metrics only (no Jira API calls), alias: --gold-only
./pipeline.py --force         # re-download all tickets from Jira
```

To add a new gold metric: create a `.py` file in `backend/tools/sync/transformations/` exposing `OUTPUT` (relative path), `FIELDS` (list of CSV column names), and `transform(issues: list) -> list[dict]`. It is auto-discovered and run in parallel.

## Architecture

### Config split
- `config.env` — non-secrets (project keys, tool registry, feature flags). Safe to commit.
- `.env` — secrets (Jira credentials, AI API keys). Gitignored; in production these are injected as environment variables.
- `backend/config.py` parses both. Routers call `load_config()` per request to get secrets.

### Tool registry
Tools are declared in `config.env` as `TOOLS[]=id|Name|description`. Homepage order follows list order. Removing a line hides the tool's homepage entry and blocks SPA navigation to it (the API routes stay mounted).

### Backend structure
All tool directories live under `backend/tools/`. Each tool is a self-contained directory with a `router.py` that registers FastAPI routes. `backend/server.py` mounts all routers under their URL prefix (e.g. `backend/tools/release_notes/router.py` → `/release-notes`). Note the Python directories use underscores (`release_notes/`) while URL prefixes use hyphens (`/release-notes`).

### Synced-data-only rule
No tool talks to Jira at request time — the Sync pipeline is the only Jira consumer. Tools read either gold CSVs or `backend/mirror.py`, an in-memory index over `backend/data/silver/` (tickets, versions from fixVersions, sprints from the sprint custom field, epics + children). The index rebuilds automatically when its signature changes (last_sync.txt mtime + silver file count). Sprint summaries are replayed from changelogs via `mirror.status_at()`. Until the first sync, `/api/accessible-tools` returns only `sync` and the homepage disables the other tools behind an alert banner.

### AI layer
`ai.py` delegates to `ai_anthropic.py` or `ai_openai.py`. Auto-detection: Anthropic if `ANTHROPIC_API_KEY` is set, else OpenAI. Both modules expose `complete(config, messages, ...)` and `stream(config, messages, ...)`. `AI_MODEL` overrides the provider's default model.

### Data pipeline (Sync)
Four-stage ETL: `_gettickets.py` (raw JSON → `backend/data/bronze/`) → `_repair.py` (corrects false-deletion artefacts) → `_bronze2silver.py` (normalised JSON → `backend/data/silver/`) → `_silver2gold.py` (CSV metrics → `backend/data/gold/`). Ask, Flow Metrics and the Epic Planner's throughput read gold; everything else reads silver via `backend/mirror.py`. Pipeline logs go to `backend/data/logs/`. The flow status→stage mapping ships at `backend/tools/sync/flow_config_default.json`; shared flow helpers (timeframe resolution, status→stage map) live in `backend/tools/flow_metrics/flow_shared.py` and are also imported by the planner.

### Frontend
React 18 + TypeScript + Vite + TailwindCSS 4. One view per tool under `frontend/src/views/`. Shared UI in `frontend/src/components/` (prefixed `App*` or standalone). No state management library — shared stateful logic lives in `frontend/src/hooks/`, pure utilities in `frontend/src/lib/`.

### Ports
- Local dev: backend `:8765`, Vite `:5173`
- Local prod: everything on `:8765`
- Docker: `:8000`
