# Cadence — Cloudflare Deployment Runbook

Operational guide for deploying and running **Cadence** on Cloudflare Containers.
Live URL: **https://cadence.kpazdera.workers.dev**

---

## 1. Architecture

Cadence runs as a single **Cloudflare Container** fronted by a thin **Worker**.

```
Browser ──▶ Worker (src/index.ts) ──▶ Container (Dockerfile)
            getByName("singleton")     uvicorn server:app  :8000
            forwards env vars          ├─ FastAPI app + built SPA
            startAndWaitForPorts()     ├─ mock Jira  :9876   (USE_MOCK_JIRA=1)
                                       └─ s3fs mount /app/backend/data ◀─▶ R2 (cadence-data)
```

- **Worker** ([src/index.ts](src/index.ts)) — a `Container` durable object (`class Cadence`). Every request goes to one singleton container instance on `defaultPort = 8000`; the Worker forwards configuration as container env vars. `sleepAfter = "2h"`.
- **Container** ([../Dockerfile](../Dockerfile)) — multi-stage build: Vite frontend → Python/FastAPI backend. Entrypoint is [../docker-entrypoint.sh](../docker-entrypoint.sh).
- **Jira is mocked** — the container also runs `tools.mock_jira` on `127.0.0.1:9876`; the sync pipeline fetches from it. No real Jira access.
- **AI is mocked** — `AI_PROVIDER=mock` selects `backend/ai_mock.py` (deterministic, offline). No real AI key used.
- **R2 is real** — `backend/data/` (synced tickets) is persisted to the `cadence-data` R2 bucket via an `s3fs` FUSE mount, so data survives container restarts.
- **Auth is on** — cookie-session login gates all data routes (see §7).

> Current account: `7e2674dacce07a6bccd8e8a85694a3f2`. Image registry: `registry.cloudflare.com/<account>/cadence-cadence`.

---

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| **Workers Paid plan** | Containers are **not** available on the Free tier. |
| **Docker** running locally | Wrangler builds + pushes the image during deploy (even `--dry-run` builds). |
| **Node + wrangler** | wrangler is installed project-local in `cloudflare/node_modules` (v4.x). Node via nvm, e.g. `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`. |
| **Cloudflare API token** | Account-owned token. Permissions: **Workers Scripts → Edit**, **Workers R2 Storage → Edit**, **Account Settings → Read**. (Account-owned tokens have no "User Details" permission — that's normal.) Stored in `../.env` as `CLOUDFLARE_API_TOKEN`. |
| **R2 S3 API token** | Separate from the deploy token. Create in dash → R2 → API → *Manage API Tokens* → **Object Read & Write**. Yields `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`; the account ID is `R2_ACCOUNT_ID`. Stored in `../.env`. |

> **Worker secrets ≠ Secrets Store.** The secrets below are *per-Worker* bindings (dash → Workers & Pages → **cadence** → Settings → **Variables and Secrets**). They do **not** appear in the account-level "Secrets Store" product.

---

## 3. Configuration reference

| File | Role |
|---|---|
| [wrangler.toml](wrangler.toml) | Worker + container + DO + R2 binding + migrations + `[vars]` + required `[secrets]` + `[observability]`. |
| [src/index.ts](src/index.ts) | Worker entry: routes to the singleton container, forwards env vars (incl. `USE_MOCK_JIRA`, `AI_PROVIDER`, auth + R2). |
| [../Dockerfile](../Dockerfile) | Image build. Installs `fuse`/`s3fs`. `VOLUME /app/backend/data`. `ENTRYPOINT docker-entrypoint.sh`. |
| [../docker-entrypoint.sh](../docker-entrypoint.sh) | Mounts R2 via s3fs when `R2_*` creds present; launches mock Jira when `USE_MOCK_JIRA=1`; then `exec uvicorn`. |
| [../.dockerignore](../.dockerignore) | **Critical** — keeps `.env` (secrets), `backend/data/`, `node_modules`, and `cloudflare/` out of the image. |
| [package.json](package.json) | `npm run deploy` / `dev` / `docker:dev`. |

### Variables vs secrets

**`[vars]` (committed, non-sensitive — mock values):**

| Var | Value | Purpose |
|---|---|---|
| `USE_MOCK_JIRA` | `1` | Entry-point launches mock Jira on :9876. |
| `JIRA_URL` | `http://127.0.0.1:9876` | Sync pipeline target (the mock). |
| `JIRA_EMAIL` / `JIRA_API_TOKEN` | mock values | Accepted but never verified by the mock. |
| `AI_PROVIDER` | `mock` | Selects `ai_mock.py`. |
| `ANTHROPIC_API_KEY` | `mock-ai-key` | Unused under mock provider. |
| `R2_BUCKET_NAME` | `cadence-data` | Bucket the container mounts. |

**`[secrets]` (real, from `../.env`, never committed):**

| Secret | Purpose |
|---|---|
| `CADENCE_AUTH_USER` / `CADENCE_AUTH_PASSWORD` | Enable cookie-session login (both required, or auth is off). |
| `CADENCE_SESSION_SECRET` | Signs session cookies (long random string; keeps logins valid across restarts). |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Real R2 creds for the s3fs mount. |

`wrangler deploy` validates all `required` secrets exist on the Worker before deploying.

---

## 4. First-time deployment

All commands from the `cloudflare/` directory:

```bash
cd cloudflare
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
export CLOUDFLARE_API_TOKEN=$(grep -E '^CLOUDFLARE_API_TOKEN=' ../.env | cut -d= -f2-)

# 1. Confirm auth + account
npx wrangler whoami

# 2. Create the R2 bucket (one-time; errors harmlessly if it already exists)
npx wrangler r2 bucket create cadence-data

# 3. Push the 6 required secrets from .env (ONLY these keys — see note)
grep -E '^(CADENCE_AUTH_USER|CADENCE_AUTH_PASSWORD|CADENCE_SESSION_SECRET|R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)=' ../.env > /tmp/cadence-secrets.env
npx wrangler secret bulk /tmp/cadence-secrets.env && rm -f /tmp/cadence-secrets.env

# 4. Deploy (builds image, pushes to registry, deploys Worker + container)
npx wrangler deploy
```

Notes:
- **Step 3 filters to 6 keys on purpose.** Bulk-uploading the whole `.env` would also push `JIRA_*` / `AI_PROVIDER` / `ANTHROPIC_API_KEY` as secrets, which **collide** with the same-named `[vars]` and break the deploy.
- `secret bulk` auto-creates the `cadence` Worker if it doesn't exist yet (no chicken-and-egg with the required-secrets check).
- First container provisioning takes **a few minutes**; the URL may briefly error until ready.

---

## 5. Redeploy / update

After code or config changes:

```bash
cd cloudflare
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
export CLOUDFLARE_API_TOKEN=$(grep -E '^CLOUDFLARE_API_TOKEN=' ../.env | cut -d= -f2-)
npx wrangler deploy
```

- Wrangler reuses cached image layers; unchanged builds skip the push.
- **The image is built from the working tree** (Dockerfile `COPY . .`), *not* from git — uncommitted changes are included. Commit separately to keep git in sync with what's live.
- Secrets/bucket persist across deploys; no need to re-run steps 2–3 unless they change.

---

## 6. Post-deploy verification

```bash
# App responds (use curl/browser — Cloudflare's edge blocks the python-urllib UA with 403)
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://cadence.kpazdera.workers.dev/

# Container rollout state
npx wrangler containers list
```

Auth flow (replace creds with the values from `../.env`):

```bash
B=https://cadence.kpazdera.workers.dev
curl -s -o /dev/null -w "shell  %{http_code}\n" $B/                       # 200 (public login page)
curl -s -o /dev/null -w "noauth %{http_code}\n" $B/sync/api/status        # 401
JAR=$(mktemp)
curl -s -o /dev/null -c "$JAR" -X POST $B/api/login -H 'Content-Type: application/json' \
  -d '{"username":"<USER>","password":"<PASS>"}'                          # 200, sets cookie
curl -s -o /dev/null -w "auth   %{http_code}\n" -b "$JAR" $B/sync/api/status  # 200
rm -f "$JAR"
```

---

## 7. First sync (populate data)

Until the first sync, only the **Sync** tool is visible (the app gates the rest on having data).

1. Log in at the URL with `CADENCE_AUTH_USER` / `CADENCE_AUTH_PASSWORD`.
2. Open **Sync Now → Sync** (or `POST /sync/api/sync` with the session cookie).
3. The pipeline fetches ~900+ tickets from the in-container mock, writes bronze→silver→gold, and persists to R2. The remaining tools then light up.

Cold-start note: the container has ephemeral disk, but `backend/data/` is on the R2 mount, so synced data survives restarts. If R2 is ever disabled, re-run the sync after a cold start.

---

## 8. Observability & logs

`[observability] enabled = true` in [wrangler.toml](wrangler.toml) turns on logging for **both** the Worker and the container (`wrangler deploy` applies `containers.configuration.observability.logs.enabled = true`).

- **Dashboard:** Workers & Pages → **cadence** → Observability (Worker logs) and the container's log view (uvicorn / sync pipeline / mock Jira stdout).
- **Real-time CLI:** `npx wrangler tail` (with `CLOUDFLARE_API_TOKEN` exported).
- **In-app sync logs:** the Sync tool reads per-run logs from `backend/data/logs/` (parsed by `backend/tools/sync/router.py::_parse_log_summary`).

> Config gotcha: observability is a **single table** — `[observability]`, not `[[observability]]` (double brackets = array → invalid, fails deploy).

---

## 9. Local development & testing

| Goal | Command (from `cloudflare/`) |
|---|---|
| Iterate on the Worker/routing | `npm run dev` (`wrangler dev`) — needs Docker; `.env` feeds local secrets. |
| Run the full app in Docker with a bind mount | `npm run docker:dev` — builds the image, mounts `../backend/data`, reads `../.env`. |
| Full app + real-S3 emulation | `docker compose up --build` (root [../docker-compose.yml](../docker-compose.yml)) — runs **RustFS** (S3-compatible, MinIO is in maintenance mode) + bucket-init + the app with s3fs. |

`wrangler dev` cannot bind-mount host dirs into the container; use `docker:dev` / `docker compose` for filesystem work.

---

## 10. Switching mock → real

**Real Jira:**
1. Set real `JIRA_URL` / `JIRA_EMAIL` in `[vars]`, and push `JIRA_API_TOKEN` as a **secret** (remove it from `[vars]`).
2. Remove `USE_MOCK_JIRA` (or set to `0`) so the entry point doesn't launch the mock.
3. Redeploy.

**Real AI:**
1. Remove `AI_PROVIDER = "mock"` (or set `anthropic`/`openai`).
2. Push a real `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) as a **secret**; remove the placeholder from `[vars]` and add the name to `[secrets].required`.
3. Redeploy.

---

## 11. Rollback

```bash
npx wrangler deployments list           # find a prior version id
npx wrangler rollback [<version-id>]    # roll the Worker back
```

For container images, redeploying a previous commit rebuilds/repushes that image. Secrets and the R2 bucket are unaffected by rollbacks.

---

## 12. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `wrangler deploy` fails: required secret missing | A `[secrets].required` key isn't set on the Worker. Run the §4 step 3 `secret bulk`. |
| Deploy fails parsing observability | `[[observability]]` used — must be `[observability]` (single table). |
| Deploy error: binding name already in use | A key exists as both a `[vars]` entry and a secret. Keep it in only one (mock values → vars; real → secret). |
| Secrets "missing" in dashboard | Looking in **Secrets Store**. Worker secrets live under the Worker → Settings → Variables and Secrets. Verify with `npx wrangler secret list`. |
| `403` on every request from a script | Cloudflare edge blocks the `python-urllib` User-Agent. Use `curl` or a browser UA. |
| App reads wrong `JIRA_URL` / leaks `.env` into image | Missing/incorrect `.dockerignore`. Ensure `.env` is excluded; never bake secrets into the image. |
| Container `provisioning` / requests error right after deploy | Normal — first provisioning takes minutes. Re-check `wrangler containers list`. |
| Docker CLI not launchable during deploy | Start Docker; ensure your user is in the `docker` group (re-login or `newgrp docker`). |
| Sync log shows no ticket counts | Older bug (fixed): fetch log now shares the pipeline log via `log_path`. Ensure `_gettickets.py`/`pipeline.py` are current. |

---

## 13. Quick command reference

```bash
cd cloudflare
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
export CLOUDFLARE_API_TOKEN=$(grep -E '^CLOUDFLARE_API_TOKEN=' ../.env | cut -d= -f2-)

npx wrangler whoami                # identity / account
npx wrangler deploy                # build + deploy
npx wrangler deploy --dry-run      # validate config + build image, no upload
npx wrangler secret list           # list secret names
npx wrangler containers list       # container app state
npx wrangler tail                  # live logs
npx wrangler deployments list      # version history
```
