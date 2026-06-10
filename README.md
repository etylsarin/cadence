# Cadence — JIRA productivity tools

Cadence is an internal engineering intelligence platform that connects to Jira and surfaces AI-powered insights for delivery teams. It helps scrum masters, engineering leads, and product managers answer questions like: "What did we ship this sprint?", "When will the backlog be done?", "What is our defect escape rate?", and "What happened in this release?"

---

## What it does

Cadence provides a collection of focused tools, each addressing a specific delivery concern:

| Tool | Purpose |
|------|---------|
| **Release Notes** | AI-generated release notes from Jira fix versions. Pick a version, choose which issue types to include, and get structured notes split into bug fixes, new features, and improvements. Individual sections can be regenerated with custom instructions. |
| **Sprint Summary** | Sprint progress at a glance — planned vs injected scope, delivered/approved breakdown, work by type. Drill into individual issues. |
| **Sync Now** | Manages the data sync pipeline that mirrors Jira data locally. Trigger syncs, view history, monitor ticket counts. |
| **Epic Planner** | Project a delivery timeline from Jira epics, team throughput, and contingency — drag-and-drop Gantt with what-if scenarios. |
| **Ask** | Natural language Q&A over your Jira data. Ask questions in plain English; an AI model reads the ticket corpus and answers with citations. |

---

## How it gets data

**Every tool works exclusively off a local mirror of Jira data** maintained by the **Sync pipeline** — the flow is always: sync first, then use the tools. Until the first sync completes, the homepage shows an alert and all tools except Sync Now are disabled. After a sync, an info bar shows when the data was last refreshed.

The pipeline is the only component that talks to Jira, via:
- **Jira REST API v3** (`/rest/api/3/`) — paginated issue discovery + per-issue download with changelogs
- Basic auth: `JIRA_EMAIL` + `JIRA_API_TOKEN`

This keeps the tools consistent (one snapshot, one truth), fast (no Jira round-trips per click), and gentle on the Jira API. Versions, sprints, and epics are all indexed in-memory from the mirror (`backend/mirror.py`); the index refreshes automatically when a sync completes.

The pipeline runs in stages:

```
Jira API
   └─ Bronze  (_gettickets.sh)   — raw JSON downloaded per project
        └─ Repair (_repair.sh)   — corrects false-deletion artefacts
             └─ Silver (_bronze2silver.py) — normalised, cleaned JSON
                  └─ Gold  (_silver2gold.py) — CSV metrics files + JSONL for AI
```

**Gold outputs** (in `backend/data/gold/`):

| File | Contents |
|------|----------|
| `throughput.csv` | Items completed per week / sprint |
| `flow_metrics.csv` | Cycle time and work-in-progress per period |
| `escaped_defects.csv` | Bug escape rate by period |
| `completed_tickets.csv` | Completed Story/Bug history (cycle times) for forecasting |
| `completed_tickets_all.csv` | Same, but covering every issue type |
| `ticket_links.csv` | Blocker / dependency relationships between tickets |
| `chat_tickets.jsonl` | Ticket data formatted for AI Q&A |

---

## How it processes data

### AI integration

Cadence has a pluggable AI layer supporting both Anthropic and OpenAI:

- Set `ANTHROPIC_API_KEY` to use **Claude** (takes priority when present)
- Set `OPENAI_API_KEY` to use **GPT-4o** (fallback when `ANTHROPIC_API_KEY` is absent)
- Set both keys and use `AI_PROVIDER=anthropic|openai` to force one
- Override the model with `AI_MODEL` (defaults: `claude-opus-4-8` for Anthropic, `gpt-4o` for OpenAI)
- If neither key is set, the server starts normally but AI requests will fail at runtime

AI is used for:
- Summarising Jira issues into structured release notes
- Answering natural language questions about ticket data (streaming responses)
- Regenerating individual release note sections with custom prompts

### Metrics computation

Flow states are categorised into stages: `pre_work → dev → testing → wait_* → post_work` (mapping shipped in `backend/tools/sync/flow_config_default.json`). The pipeline computes throughput and per-status flow times from status transition history in the mirrored data; the Epic Planner derives team throughput and the P85 release-wait tail from these.

---

## Technology stack

**Backend**
- Python 3.9+ (Docker image uses 3.11), FastAPI, Uvicorn
- No ORM — metrics are served from CSV files
- AI API calls use the standard library (`urllib`); Jira is reached only by the Sync pipeline (`curl` + `jq`)

**Frontend**
- React 18 + TypeScript, Vite
- React Router, TailwindCSS 4, Chart.js, Lucide icons

**Deployment**
- Docker (single image, multi-stage build)
- Host-agnostic — runs anywhere that runs a container or a Python/Uvicorn process

---

## Getting started

### 1. Prerequisites

- Python 3.9+
- Node.js 20+ (see note below about `run.sh`)
- `jq` and `curl` (required for the Sync pipeline when running locally)
- A Jira account with API token access
- An Anthropic or OpenAI API key (for AI features)

> **Note on Node:** `run.sh` currently hard-codes a local Node path (`$HOME/node-v24.14.0-darwin-arm64/bin`). If that path does not exist on your machine, edit `run.sh` lines 8–10 to point to your Node installation (e.g. replace with `NODE_BIN="$(dirname $(which node))"`). This is not required when running via Docker.

### 2. Configuration

Copy the secrets template and fill in your values:

```bash
cp .env.example .env
```

`.env` — secrets, never committed:

```ini
JIRA_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@yourcompany.com
JIRA_API_TOKEN=your_jira_api_token

# Set one or both AI keys. Anthropic takes priority; OpenAI is the fallback.
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
# AI_PROVIDER=anthropic        # force a provider; auto-detected when omitted
# AI_MODEL=claude-opus-4-8     # overrides default (claude-opus-4-8 / gpt-4o)

# App login — optional. Set BOTH to put the app behind a login page;
# leave unset for open access (local-dev default).
# CADENCE_AUTH_USER=team
# CADENCE_AUTH_PASSWORD=change-me
# CADENCE_SESSION_SECRET=any-long-random-string   # keeps logins valid across restarts
```

`config.env` — non-secrets, safe to commit:

```ini
# Jira project keys to include across all tools
PROJECTS=PROJ1,PROJ2,PROJ3

# Sync pipeline scope
SYNC_ISSUE_TYPES=Story,Spike,Bug,Task
SYNC_START_DATE=2024-01-01

# Tool registry — homepage order follows list order; comment out a line to hide a tool
TOOLS[]=sync|Sync Now|Manage the Jira mirror pipeline…
TOOLS[]=ask|Ask|Chat with your Jira data…
TOOLS[]=release-notes|Release Notes|Generate AI-powered release notes…
TOOLS[]=sprint-summary|Sprint Summary|Summarise sprint progress…
TOOLS[]=planner|Epic Planner|Project a delivery timeline…

# CORS allowed origins — comma-separated. Restrict this in production.
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8765,http://localhost:8000
```

### 3. Install dependencies

```bash
# Backend — use a virtual environment to avoid conflicts
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install
```

### 4. Run in development mode

```bash
./run.sh dev
```

- Frontend: `http://localhost:5173` (Vite with hot-module reload)
- Backend: `http://localhost:8765` (FastAPI with auto-reload)

### 5. Run in production mode

```bash
./run.sh prod
```

Builds the frontend, then serves everything from a single FastAPI process on port `8765`.

### 6. Docker

```bash
docker build -t cadence .
docker run -p 8000:8000 \
  -e JIRA_URL=https://yourcompany.atlassian.net \
  -e JIRA_EMAIL=you@yourcompany.com \
  -e JIRA_API_TOKEN=... \
  -e ANTHROPIC_API_KEY=... \
  cadence
```

> **Note:** The Docker image serves on port **8000** (mapped by `-p 8000:8000`), whereas local dev and prod modes use port **8765**.

---

## Syncing Jira data (Sync pipeline)

Tools that use pre-computed metrics (Ask, Epic Planner) require a local data sync. Run the pipeline from the `backend/tools/sync/` directory:

```bash
cd backend/tools/sync

# Full pipeline: fetch from Jira, repair, normalise, compute metrics
./pipeline.py

# Recompute metrics without hitting the Jira API (fast)
./pipeline.py --silver-only   # or --gold-only (alias)

# Force re-download all tickets (ignores incremental state)
./pipeline.py --force
```

> **Note:** `pipeline.py` uses relative paths internally — it must be run from the `backend/tools/sync/` directory as shown above.

You can also trigger a sync from the **Sync Now** tool in the UI.

### Demo data (no Jira required)

To try the data-driven tools locally without Jira credentials, generate synthetic seed data:

```bash
python3 backend/tools/seed_demo_data.py
```

This writes ~2,400 realistic issues (with changelogs, links, sprints, epics, escaped-defect fields) into `backend/data/silver/` + `backend/data/bronze/`, then runs the **real** silver→gold transformations to produce every gold file. Deterministic — rerunning regenerates the same data. A running backend picks the new data up automatically.

Since all tools read the synced mirror, seeding alone makes everything work — the seed writes the same silver layer a real sync produces (plus Epics, sprints, versions, and backlog baked in).

### Mock Jira + mock AI (fully offline)

To exercise the *real* sync flow end-to-end, a mock Jira server can stand in
for Jira. It generates its ticket corpus in-memory at startup (same
deterministic generators as the seed script; no `data/` needed) and serves
exactly the endpoints the pipeline calls:

```bash
python3 -m uvicorn tools.mock_jira:app --app-dir backend --port 9876
```

Then point the app at it in `.env`:

```ini
JIRA_URL=http://localhost:9876
JIRA_EMAIL=demo@example.com
JIRA_API_TOKEN=demo-token
AI_PROVIDER=mock        # deterministic canned AI output (ai_mock.py); swap for a real key anytime
```

With the mock running, the **full Sync pipeline** works offline:
`cd backend/tools/sync && ./pipeline.py` (or the Sync button in the UI)
rebuilds bronze/silver/gold from scratch against the mock — discovery,
per-ticket download with `expand=changelog`, incremental re-sync via
`updated` timestamps, deletion detection. After that every tool runs on the
mirror exactly as it would in production: browse versions/sprints/epics per
squad, view sprint issues classified planned / injected / carried-over /
delivered / approved (replayed from changelogs), plan epics on the timeline
(each epic ships with an open backlog), and Generate / Regenerate
release-note sections via the mock AI provider.

Mock coverage is intentionally tiny — the two endpoints the pipeline calls:
paginated `POST /rest/api/3/search/jql` for the discovery query
(`project in … AND issuetype in … AND created >= "…"`) and
`GET /rest/api/3/issue/{key}?expand=changelog`. Everything else the tools
need (versions, sprints, epics) is carried *inside* the synced tickets and
indexed by `backend/mirror.py`. Extendable per tool.

---

## Project structure

```
cadence/
├── config.env           # Non-secret app config (committed)
├── .env                 # Secrets (gitignored) — see .env.example
├── run.sh               # Dev / prod launcher
├── Dockerfile
│
├── backend/             # Python (FastAPI) backend
│   ├── server.py        # FastAPI app — mounts all routers, serves the SPA
│   ├── config.py        # Configuration loader (reads ../config.env + ../.env)
│   ├── mirror.py        # In-memory index over the synced silver layer (all tools read this)
│   ├── ai.py            # AI provider abstraction (anthropic | openai | mock)
│   ├── ai_anthropic.py / ai_openai.py / ai_mock.py
│   ├── requirements.txt
│   │
│   ├── tools/           # All tool backends — each has a router.py mounted by server.py
│   │   ├── release_notes/   # Release notes router + AI generation
│   │   ├── sprint_summary/  # Sprint analytics router
│   │   ├── ask/             # Natural language Q&A router
│   │   ├── planner/         # Epic Planner router + flow helpers
│   │   ├── sync/            # Data pipeline (Jira → metrics CSVs)
│   │   │   └── pipeline.py  # Pipeline orchestrator
│   │   ├── mock_jira.py     # Offline Jira stand-in for the Sync pipeline (generated corpus)
│   │   └── seed_demo_data.py# Synthetic data generator
│   │
│   └── data/            # Sync pipeline output (gitignored)
│       ├── bronze/      # Raw Jira JSON
│       ├── silver/      # Cleaned JSON
│       ├── gold/        # Computed CSV/JSONL metrics
│       └── logs/        # Pipeline run logs (timestamped)
│
└── frontend/            # React 18 + TypeScript SPA
    └── src/
        ├── views/       # One React view per tool
        ├── components/  # Shared UI components
        ├── hooks/       # Shared stateful logic (dark mode, project, …)
        └── lib/         # Pure utilities (API wrapper, tags, JQL)
```

---

## Logs and troubleshooting

Pipeline run logs are written to `backend/data/logs/` with timestamped filenames (e.g. `2026-03-15T10-30-00Z.log`). Check there first if a sync fails or produces unexpected output.

For the server, FastAPI writes request logs to stdout — run `./run.sh dev` to see them in the terminal, or check the container logs (`docker logs <container>`) in Docker.

---

## Tool visibility

The homepage shows every tool in the `TOOLS[]` registry, in list order. To hide a tool, remove or comment out its line in `config.env` — it disappears from the homepage and the SPA redirects direct navigation back home.

Independently of the registry, **all tools except Sync Now are disabled until the first sync completes** (greyed-out cards, navigation redirects home). The banner above the tool list shows the last sync time once data exists, or an alert telling you to sync first when it doesn't.

---

## Authentication

Cadence ships with an optional login page. Set **both** `CADENCE_AUTH_USER` and `CADENCE_AUTH_PASSWORD` (env vars, or `.env` locally / environment variables in production) and the app requires a sign-in: every data route (`/api/*` and the tool APIs) returns 401 without a valid session, and the frontend shows the login page instead of the app. Leave them unset and the app is open, which is the local-dev default.

Sessions are HMAC-signed cookies (7-day expiry, `httponly`, no server-side store). Set `CADENCE_SESSION_SECRET` to keep sessions valid across server restarts — without it a fresh secret is generated at boot and every restart signs everyone out.

This is a single shared credential suitable for an internal tool. For per-user SSO, front the app with an authenticating reverse proxy or your platform's built-in authentication instead — the app will sit behind it unchanged.

---

## Contributing

This is an internal tool with no formal test suite. To contribute, open a branch, make your changes, and raise a PR against `main`. There is no license — all rights reserved.
