# Cadence — 10-minute Presentation Deck

5 slides · ~2 min per slide · leave 1–2 min for questions

---

## Slide 1 — Title

### Cadence
**Engineering intelligence for your Jira data**

> "Stop digging in Jira. Start answering questions."

**Speaker notes (30 sec)**

Cadence is an internal platform we built to turn our Jira data into answers. Instead of hunting through boards and filters, you ask a question or click a button and get a summary, a forecast, or a report — powered by the data we already have.

---

## Slide 2 — The Problem

### Every team has the data. Nobody has the time to read it.

- Jira is a source of truth, not a source of insight — extracting meaning means manual digging
- Sprint reports, release notes, and forecasts are written by hand every week, from the same raw data
- Ticket hygiene issues silently corrupt velocity and cycle-time metrics before anyone notices

**Speaker notes (1.5 min)**

Every sprint, someone on the team spends an hour writing a sprint summary that Jira already contains — they just have to piece it together. Every release, someone combs through closed tickets to draft release notes. And when our metrics look off, we don't know if it's a real trend or a field someone forgot to update. Cadence is built around a simple idea: the data is already there. We just need to make it answerable.

---

## Slide 3 — What Cadence Does

### Eight focused tools. One source of truth.

| Tool | What it does |
|---|---|
| **Ask** | Chat with your Jira data in plain English — get answers with cited tickets |
| **Sprint Summary** | Planned vs injected, delivered vs carried-over, at a glance |
| **Release Notes** | AI-generated release notes from any fix version, by issue type |
| **Flow Metrics** | Cycle time, lead time, WIP aging, and stage breakdown from delivery history |
| **Epic Planner** | Project a delivery timeline from epics, team throughput, and contingency |
| **Hygiene Auditor** | Find the ticket fields that corrupt your metrics, with an AI fix plan |
| **Prompt Builder** | Compose a Claude prompt from a ticket's description, epic, and attachments |
| **Sync Now** | Mirror and refresh your Jira data — everything else runs from here |

**Speaker notes (2 min)**

Let me walk through the two you'll use most day-to-day. Ask lets you type a question — "what did we ship last sprint?", "how many bugs escaped to production this quarter?" — and get a streamed answer with the tickets cited inline. You don't need to know JQL. Sprint Summary gives you the same view every sprint retrospective needs: what was planned, what was injected, what got delivered, what carried over — with a drill-down to individual issues. Release Notes takes any fix version and generates structured output split into features, improvements, and bug fixes — and you can regenerate individual sections with custom instructions if the AI draft isn't quite right.

---

## Slide 4 — How It Works

### One sync. Every tool runs from the mirror.

```
Jira API ──▶ Sync Pipeline ──▶ Local Mirror ──▶ All Tools
              (Bronze → Silver → Gold)           (+ Claude / GPT-4o)
```

- Cadence never queries Jira at click-time — one sync mirrors your data locally, so every tool is fast and consistent
- The pipeline normalises raw Jira JSON into clean metrics: throughput, cycle time, escaped defects, changelog history
- AI generation uses Claude (or GPT-4o as fallback) — called only when you generate content, not on every page load

**Speaker notes (2 min)**

The key design decision is: every tool reads from a local mirror, not live from Jira. You run a sync — which takes a few minutes for a large project — and after that every click is instant. This also means all tools see the same snapshot, so your sprint summary and flow metrics always agree. The pipeline has four stages: raw JSON download, artefact repair, normalisation into clean JSON, and metric computation into CSV files. AI is additive on top — for Ask, Release Notes, and the Hygiene Auditor — and uses whatever API key you've configured. If you want to try it without a Jira account, we ship demo data.

---

## Slide 5 — Get Started

### Running in under 5 minutes.

**Three steps:**

1. **Configure** — add your Jira API token and an Anthropic or OpenAI key to `.env`
2. **Sync** — run the pipeline or click Sync Now in the UI; all tools unlock automatically
3. **Use** — every tool reads from the mirror; re-sync whenever you need fresh data

**Deployment options:**

| Option | Command |
|---|---|
| Local dev (hot-reload) | `./run.sh dev` |
| Local prod (single process) | `./run.sh prod` |
| Docker | `docker run -p 8000:8000 cadence` |

Optional: set `CADENCE_AUTH_USER` + `CADENCE_AUTH_PASSWORD` to put the app behind a login page.

**Closing line:**

Cadence is an internal tool — no vendor dependency, no data leaving your network beyond Jira and your AI provider. The code is ours; the tools are yours to extend.

**Speaker notes (1 min)**

If you want to try it today, grab the repo, copy `.env.example`, drop in your credentials, and run `./run.sh dev`. If you don't have Jira credentials handy, run `seed_demo_data.py` first — it generates realistic synthetic tickets and makes every tool fully functional.
