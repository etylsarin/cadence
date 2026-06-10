"""agent.py — provider-agnostic agentic loop with guardrails.

Exposes run_agent(), a generator that yields SSE-friendly event dicts:
  {"type": "tool_call",           "tool": name, "args": {...}}
  {"type": "tool_result_summary", "tool": name, "summary": "...", "is_error": bool}
  {"type": "text",                "text": "..."}
  {"type": "done",                "usage": {...}}

The router wraps these into SSE data lines and forwards them to the client.
"""

import json
import logging

import ai as _ai

logger = logging.getLogger(__name__)

_MAX_ITERATIONS = 12
_MAX_TOOL_CHARS = 20_000


def run_agent(config: dict, question: str, tools: list, system: str, *,
              max_iterations: int = _MAX_ITERATIONS,
              max_tool_chars:  int = _MAX_TOOL_CHARS):
    """Generator. `tools` is a list of {"schema": {...}, "fn": callable} dicts.

    tool schema shape (Anthropic-native; ai_openai converts on its side):
      {"name": ..., "description": ..., "input_schema": {"type": "object", ...}}
    """
    tool_schemas = [t["schema"] for t in tools]
    tool_map     = {t["schema"]["name"]: t["fn"] for t in tools}

    messages: list = [{"role": "user", "content": question}]
    total_usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}

    for iteration in range(max_iterations):
        try:
            result = _ai.complete_with_tools(
                config, messages, tool_schemas, system=system)
        except Exception as exc:
            logger.exception("complete_with_tools failed on iteration %d", iteration)
            yield {"type": "text", "text": f"[Agent error: {exc}]"}
            break

        for k in total_usage:
            total_usage[k] += result["usage"].get(k, 0)

        if result["stop_reason"] != "tool_use" or not result["tool_calls"]:
            yield {"type": "text", "text": (
                result["text"] or "[No response — please try rephrasing your question]"
            )}
            break

        # Stream any prose the model emitted before the tool calls.
        if result["text"]:
            yield {"type": "text", "text": result["text"]}

        # Append assistant turn to history.
        messages.append(_ai.make_assistant_message(config, result))

        # Execute each tool call the model requested (may be batched).
        tool_results = []
        for tc in result["tool_calls"]:
            # Include id so the frontend can resolve batched same-tool calls correctly.
            yield {"type": "tool_call", "id": tc["id"], "tool": tc["name"], "args": tc["input"]}

            try:
                fn = tool_map.get(tc["name"])
                if fn is None:
                    raise ValueError(f"Unknown tool: {tc['name']!r}")
                raw = fn(**tc["input"])
                result_text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
                if len(result_text) > max_tool_chars:
                    result_text = result_text[:max_tool_chars] + "\n[truncated — narrow your search]"
                is_error = False
            except Exception as exc:
                result_text = f"Error: {exc}"
                is_error = True

            summary = result_text[:200].replace("\n", " ")
            yield {"type": "tool_result_summary", "id": tc["id"], "tool": tc["name"],
                   "summary": summary, "is_error": is_error}
            tool_results.append({"id": tc["id"], "content": result_text, "is_error": is_error})

        # Append tool results to history.
        messages.extend(_ai.make_tool_result_message(config, tool_results))

        # On the last allowed iteration, force a final text-only turn.
        # Pass tools=[] so the model cannot call tools again (fixes consecutive
        # user-message 400 on Anthropic and the silent-empty-answer bug).
        if iteration == max_iterations - 1:
            try:
                final = _ai.complete_with_tools(
                    config, messages, [], system=system)
            except Exception as exc:
                logger.exception("force-final turn failed")
                yield {"type": "text", "text": f"[Agent error on final turn: {exc}]"}
            else:
                for k in total_usage:
                    total_usage[k] += final["usage"].get(k, 0)
                yield {"type": "text", "text": (
                    final["text"] or
                    "[Agent reached the iteration limit — see tool results above]"
                )}

    yield {"type": "done", "usage": total_usage}
