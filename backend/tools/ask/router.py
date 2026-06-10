"""
Ask — Natural language Q&A over Sync gold data.

Loads chat_tickets.jsonl (produced by the Sync pipeline), filters by
project and time window, and streams a Claude response over SSE.
"""

import json
import time
import urllib.error
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import ai as _ai
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import PROJECTS, load_config

router = APIRouter()

_DATA_PATH = (
    Path(__file__).parent.parent.parent / "data" / "gold" / "chat_tickets.jsonl"
)

_tickets: Optional[list] = None
_tickets_cached_at: float = 0
_CACHE_TTL = 300  # 5 minutes

# Hard cap on tickets sent to the LLM in one request. An unbounded prompt
# overflows the model's context window (a hard API error, not graceful
# degradation) and balloons token cost. We keep the most-recent slice.
_MAX_TICKETS = 1200


# ── Data loading ───────────────────────────────────────────────────────────────

def _load_tickets() -> list:
    global _tickets, _tickets_cached_at
    now = time.time()
    # Use cache if <5 min old
    if _tickets is not None and (now - _tickets_cached_at) < _CACHE_TTL:
        return _tickets
    # Otherwise reload
    if not _DATA_PATH.exists():
        _tickets = []
    else:
        with open(_DATA_PATH) as f:
            _tickets = [json.loads(line) for line in f if line.strip()]
    _tickets_cached_at = now
    return _tickets


def _filter_tickets(tickets: list, project: str, months: int) -> list:
    if project and project != "ORG":
        tickets = [t for t in tickets if t.get("project") == project]

    if months:
        cutoff = (date.today() - timedelta(days=months * 30)).strftime("%Y-%m-%d")
        tickets = [t for t in tickets if (t.get("created") or "") >= cutoff]

    # Most recent first, then cap at _MAX_TICKETS so the prompt can't overflow
    # the model's context window or run away on cost for large projects.
    tickets = sorted(tickets, key=lambda t: t.get("created") or "", reverse=True)
    return tickets[:_MAX_TICKETS]


# ── Context formatting ─────────────────────────────────────────────────────────

def _format_ticket(t: dict) -> str:
    parts = [f"[{t.get('key', '')}]", t.get("type", "")]

    priority = t.get("priority", "")
    if priority and priority not in ("Medium", ""):
        parts.append(priority)

    summary = (t.get("summary") or "")[:70]
    parts.append(f'"{summary}"')

    parts.append(t.get("status", ""))

    sp = t.get("story_points")
    if sp is not None:
        parts.append(f"SP:{sp:.0f}")

    if t.get("assignee"):
        parts.append(t["assignee"])

    if t.get("sprint"):
        parts.append(f"[{t['sprint'][:28]}]")

    created  = t.get("created", "")
    resolved = t.get("resolved")
    if created:
        parts.append(created + (f"→{resolved}" if resolved else ""))

    transitions = t.get("transitions") or []
    if transitions:
        nodes = [transitions[0]["from"]] + [tr["to"] for tr in transitions]
        path = "→".join(nodes)
        if len(path) > 80:
            path = "→".join(nodes[:2]) + "→…→" + "→".join(nodes[-2:])
        parts.append(path)

    line = " | ".join(parts)

    # Second line for description and bug-specific fields
    extras = []
    if t.get("description"):
        extras.append(f'note:"{t["description"][:120]}"')
    if t.get("root_cause"):
        extras.append(f'root_cause:{t["root_cause"]}')
    if t.get("environment"):
        extras.append(f'env:{t["environment"]}')
    if extras:
        line += "\n  " + "  ".join(extras)

    return line


def _build_system_prompt(tickets: list, project: str, months: int) -> str:
    project_desc = (
        project if project != "ORG"
        else f"all squads ({', '.join(PROJECTS)})"
    )
    time_desc = f"last {months} months" if months else "all time"

    context = "\n".join(_format_ticket(t) for t in tickets)

    return f"""You are an AI assistant helping a software delivery team analyse their Jira project data.

You have access to {len(tickets)} tickets from {project_desc}, covering {time_desc}.

Ticket format:
  [KEY] Type Priority "Summary" | Status | SP:points | Assignee | [Sprint] | Created→Resolved | WorkflowPath
  note:"description"  root_cause:...  env:...

Answer questions based on the ticket data. Reference ticket keys when relevant.
Use markdown formatting. Be concise but thorough.
If the data doesn't support a conclusion, say so clearly.

TICKET DATA:
{context}"""


# ── AI streaming ───────────────────────────────────────────────────────────────

def _stream_ai(config: dict, system_prompt: str, question: str):
    """Sync generator — yields raw text chunks from the AI streaming API."""
    yield from _ai.stream(
        config,
        messages=[{"role": "user", "content": question}],
        system=system_prompt,
        max_tokens=2048,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    question: str
    project:  str = "ORG"
    months:   int = 6   # 0 = all time


@router.get("/api/info")
def get_info():
    tickets = _load_tickets()
    return {"total_tickets": len(tickets), "available": len(tickets) > 0}


@router.post("/api/chat")
def chat(body: ChatRequest):
    config = load_config()

    all_tickets = _load_tickets()
    if not all_tickets:
        raise HTTPException(503, "chat_tickets.jsonl not found — run the Sync pipeline first")

    filtered  = _filter_tickets(all_tickets, body.project, body.months)
    if not filtered:
        raise HTTPException(400, "No tickets match the selected filters")

    system_prompt = _build_system_prompt(filtered, body.project, body.months)

    def sse_stream():
        try:
            for chunk in _stream_ai(config, system_prompt, body.question):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            yield f"data: {json.dumps({'error': f'AI API error {e.code}: {err}'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse_stream(), media_type="text/event-stream")
