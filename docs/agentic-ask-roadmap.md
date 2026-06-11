# Roadmap: Agentic Ask — replace context-stuffing with a tool-use loop

## Background

Today the Ask tool (`backend/tools/ask/router.py`) answers questions by stuffing up to
1,200 truncated ticket one-liners from `gold/chat_tickets.jsonl` into the system prompt
and doing a single-shot completion. Everything outside that slice — full descriptions,
changelogs, epic structure, sprint history — is invisible to the model.

The replacement is an **agentic loop**: the model gets read-only search tools over the
synced data and iterates (search → read → follow links → answer), the same way coding
agents work over a repository. This project is well positioned for this because the corpus already lives as files:

- `backend/data/silver/*.json` — one file per ticket (~930 files, ~3.6 MB), full fields + changelog
- `backend/data/gold/*.csv|jsonl` — precomputed metrics (~1.4 MB)
- `backend/mirror.py` — in-memory index (epics → children, sprints, versions, `status_at()`)

**What does not change:** the synced-data-only rule (the agent never talks to Jira at
request time), the provider split in `ai.py`, the tool registry, SSE streaming to the
frontend, and the config split (`config.env` / `.env`).

---

## Architecture at a glance

```
Ask.tsx ──POST /ask/api/agent-chat (SSE)──▶ ask/router.py
                                               │
                                               ▼
                                        backend/agent.py        (the loop)
                                          │         ▲
                                 tool calls│         │tool results
                                          ▼         │
                                   ask/agent_tools.py
                                     ├─ grep / read / list  ──▶ backend/data/{silver,gold}
                                     └─ domain tools        ──▶ backend/mirror.py
                                               │
                                               ▼
                                 ai.py → ai_anthropic.py / ai_openai.py
                                        (tool-use API calls)
```

Design decisions (made up front so the phases don't relitigate them):

1. **Discrete tools, not a simulated bash.** `grep`/`read`/`list` as separate typed
   tools are path-jailed, parseable, and have no shell-injection surface. Models drive
   them as well as a terminal.
2. **Domain tools on top of `mirror.py`.** Epic membership, sprint replay
   (`status_at`), and version rollups already exist as Python — exposing them as tools
   beats making the model re-derive Jira semantics from raw changelog JSON every time.
3. **Keep the raw-HTTP provider modules.** `ai_anthropic.py` / `ai_openai.py` stay
   dependency-free urllib code, extended with tool support. (Alternative: adopt the
   official `anthropic` SDK, which ships a tool runner and typed errors — revisit if
   the hand-rolled loop grows maintenance cost. Decide once, before Phase 1.)
4. **New endpoint alongside the old one.** `/ask/api/agent-chat` ships next to
   `/ask/api/chat` so quality can be compared before the old path is removed.
5. **Model:** keep the provider default (`claude-opus-4-8`) for development; the
   existing `AI_MODEL` config override is the cost lever. After the eval phase
   (Phase 6), test `claude-sonnet-4-6` (~$3/$15 per MTok vs $5/$25) — likely
   sufficient for search-and-cite work — and `claude-haiku-4-5` as the aggressive
   option.

---

## Phase 1 — Tool support in the provider modules

**Goal:** the AI layer can send tool definitions and return structured responses.

Both `ai_anthropic.py` and `ai_openai.py` currently expose text-only
`complete()`/`stream()`. Add one new function to each (and a dispatcher in `ai.py`):

```python
def complete_with_tools(config, messages, tools, system=None, max_tokens=4096) -> dict:
    """One model turn. Returns a normalized dict:
    {
      "stop_reason": "tool_use" | "end_turn",
      "content":     <provider-native content, replayed verbatim into history>,
      "text":        "concatenated text blocks",
      "tool_calls":  [{"id": ..., "name": ..., "input": {...}}, ...],
      "usage":       {"input_tokens": ..., "output_tokens": ...,
                      "cache_read_input_tokens": ...},
    }
    """
```

Anthropic specifics (Messages API, same `_post`/`_body` style):
- Add `tools` (name / description / `input_schema`) to the request body.
- Parse `content` blocks: collect `text` blocks and `tool_use` blocks; read `stop_reason`.
- Tool results go back as a `user` message of `tool_result` blocks, each carrying the
  matching `tool_use_id`. The assistant's full `content` must be echoed into history first.
- Add `cache_control: {"type": "ephemeral"}` on the system prompt block — in a loop the
  prefix is re-sent every iteration, and cached reads cost ~0.1× input price. This is
  the single biggest cost lever (bigger than model choice).

OpenAI specifics: same normalized return shape, mapped from `tool_calls` /
`finish_reason == "tool_calls"`, results returned as `role: "tool"` messages.

`ai_mock.py` gets a canned tool-use script so the loop is testable offline.

**Done when:** a pytest-style script can run one round-trip (model asks for a tool,
gets a result, produces text) against both providers and the mock.

---

## Phase 2 — The agent loop

**Goal:** `backend/agent.py`, a provider-agnostic loop with hard guardrails.

```python
def run_agent(config, question, tools, system, *,
              max_iterations=12, max_tool_chars=20_000):
    # yields events: {"type": "tool_call", ...} | {"type": "tool_result_summary", ...}
    #              | {"type": "text", ...} | {"type": "done", "usage": ...}
```

- Loop: call `complete_with_tools` → if `stop_reason == "tool_use"`, execute every
  requested tool (the model may batch several per turn), append the assistant content
  + tool results to history, repeat → else yield final text and stop.
- **Guardrails:**
  - `max_iterations` cap (12); on hitting it, force a final text-only turn
    ("answer with what you have").
  - Tool output truncated at `max_tool_chars` with an explicit
    `"[truncated — narrow your search]"` marker so the model self-corrects.
  - Tool execution errors are returned as `is_error` tool results, never raised —
    the model recovers or reports.
  - Cumulative token budget (log `usage` per turn; abort past a configurable ceiling).
- Generator interface so the router can forward progress events over SSE as they happen.

**Done when:** the loop answers a multi-hop question against the mock provider and
terminates correctly on the iteration cap.

---

## Phase 3 — The tools

**Goal:** `backend/tools/ask/agent_tools.py` — read-only, path-jailed, mirror-aware.

File tools (jailed to `backend/data/silver` and `backend/data/gold`; reject `..`,
absolute paths, symlinks):

| Tool | Input | Returns |
|---|---|---|
| `grep` | `pattern` (regex), `glob` (e.g. `silver/ADM-*.json`), `max_results` | matching lines as `path: line`, capped |
| `read` | `path` | full file content (one ticket JSON or a gold CSV slice) |
| `list_files` | `glob` | matching paths + sizes |

Domain tools (thin wrappers over `mirror.get_mirror()` and `flow_shared.py`):

| Tool | Backed by | Why a tool and not grep |
|---|---|---|
| `get_ticket` | `mirror.by_key` | clean single-ticket fetch incl. transitions via `status_transitions()` |
| `get_epic` | `mirror.epics` + `children_by_epic` | epic → children join is precomputed |
| `list_sprints` / `get_sprint` | `mirror.sprints_by_project` | sprint membership comes from the custom field |
| `status_at` | `mirror.status_at()` | changelog replay — expensive to re-derive from raw JSON |
| `list_versions` | `mirror.versions` | fixVersion rollups |

Each tool needs a **prescriptive description stating when to call it** (e.g. "Call
`get_epic` when the question concerns an initiative/epic and its children"), not just
what it does — this measurably improves should-call rates.

System prompt: who the user is (delivery team), what the data is (project keys from
`PROJECTS`, silver/gold layout, ticket JSON shape), the citation rule ("reference
ticket keys"), and a stop rule ("answer when you have enough evidence; don't
exhaustively read").

**Done when:** unit tests cover path-jail escapes, truncation, and each domain tool
against seeded demo data (`seed_demo_data.py`).

---

## Phase 4 — Router + SSE protocol

**Goal:** `POST /ask/api/agent-chat` streaming the loop's progress.

Extend the existing SSE shape (today: `{"text": ...}` / `{"error": ...}` / `[DONE]`)
with tool events:

```
data: {"tool": "grep", "args": {"pattern": "onboarding", "glob": "silver/*.json"}}
data: {"tool_done": "grep", "summary": "14 matches"}
data: {"text": "Looking at ADM-1000…"}
data: {"usage": {"input_tokens": ..., "cache_read_input_tokens": ...}}
data: [DONE]
```

- Same 503-when-not-synced behavior as the current endpoint.
- Keep `project`/`months` request fields as *hints* injected into the system prompt
  (the agent can still look anywhere — filters are no longer load-bearing).
- Log per-request: iterations, tools called, token usage, wall time → `backend/data/logs/`.

**Done when:** `curl -N` against the endpoint shows interleaved tool + text events
for a real question.

---

## Phase 5 — Frontend

**Goal:** `frontend/src/views/ask/Ask.tsx` renders agent activity.

- Parse the new event types; render tool calls as collapsed activity lines
  ("🔎 searched tickets for `onboarding` — 14 matches") above the streaming answer,
  so the 20–30 s loop doesn't look like a hang.
- Keep markdown rendering of the final answer unchanged.
- Optional toggle between classic `/api/chat` and `/api/agent-chat` while both exist.

**Done when:** asking a question in the UI shows live tool activity and a final answer.

---

## Phase 6 — Evaluation, model selection, rollout

**Goal:** prove it's better, pick the cheapest adequate model, retire the old path.

1. Build a fixed set of 10–15 questions with known-correct answers, including ones the
   current Ask *cannot* answer (full descriptions, changelog timing, epic rollups,
   "what happened to X between sprint 33 and 34").
2. Run classic vs agentic side by side; compare accuracy, hallucination rate, latency,
   cost per question (from the logged `usage`).
3. Model sweep via `AI_MODEL`: `claude-opus-4-8` (baseline) → `claude-sonnet-4-6` →
   `claude-haiku-4-5`. Expected per-question cost with caching: roughly $0.20–0.30 /
   $0.10–0.15 / $0.03–0.05 respectively. Pick the cheapest model that holds the
   baseline's accuracy on the eval set — verify, don't assume.
4. Rollout: flip the Ask UI default to the agentic endpoint, keep classic behind the
   toggle for one release, then delete `_build_system_prompt`/`_format_ticket` and the
   `_MAX_TICKETS` machinery.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Runaway loops / cost | iteration cap, tool-output cap, cumulative token ceiling, usage logging (Phase 2) |
| Cache misses making the loop ~10× pricier | `cache_control` on system prompt + stable prefix ordering; verify `cache_read_input_tokens > 0` in logs (Phases 1, 4) |
| Path traversal via tool args | jail + reject `..`/absolute/symlink in one shared resolver, unit-tested (Phase 3) |
| Prompt injection from ticket text | tools are read-only over local files; no write/network tools exist, so the blast radius is a wrong answer (accepted) |
| OpenAI provider drift | normalized `complete_with_tools` contract + mock provider tests (Phase 1) |
| Worse answers than classic on simple aggregate questions ("how many bugs last month") | gold CSVs stay available via `read`; eval set includes aggregate questions (Phase 6) |

## Rough sizing

Phases 1–2 are the substance (~2 days). Phase 3 is mostly delegation to `mirror.py`
(~1 day). Phases 4–5 are plumbing (~1 day). Phase 6 runs alongside (~½ day of setup).
Total: **roughly one week** of focused work, shippable incrementally — each phase
leaves `main` working.
