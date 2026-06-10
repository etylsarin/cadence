"""Anthropic provider — complete(), stream(), and complete_with_tools() implementations."""

import json
import urllib.request

_API_VERSION   = "2023-06-01"
_URL           = "https://api.anthropic.com/v1/messages"
_TIMEOUT       = 120  # seconds — generous for LLM latency, but never hang forever
_DEFAULT_MODEL = "claude-opus-4-8"  # used when AI_MODEL is not set


def _credentials(config: dict) -> tuple[str, str]:
    api_key = config.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    model = config.get("AI_MODEL") or _DEFAULT_MODEL
    return api_key, model


def _post(api_key: str, body: dict) -> urllib.request.Request:
    return urllib.request.Request(
        _URL,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type":      "application/json",
            "x-api-key":         api_key,
            "anthropic-version": _API_VERSION,
        },
    )


def _body(model: str, messages: list, system: str, max_tokens: int, stream: bool) -> dict:
    body = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if system: body["system"] = system
    if stream: body["stream"] = True
    return body


def complete(config: dict, messages: list, system: str = None, max_tokens: int = 4096) -> str:
    api_key, model = _credentials(config)
    with urllib.request.urlopen(_post(api_key, _body(model, messages, system, max_tokens, stream=False)), timeout=_TIMEOUT) as resp:
        return json.loads(resp.read())["content"][0]["text"]


def stream(config: dict, messages: list, system: str = None, max_tokens: int = 2048):
    api_key, model = _credentials(config)
    with urllib.request.urlopen(_post(api_key, _body(model, messages, system, max_tokens, stream=True)), timeout=_TIMEOUT) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8").rstrip()
            if not line.startswith("data: "):
                continue
            try:
                event = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if event.get("type") == "content_block_delta":
                text = event.get("delta", {}).get("text", "")
                if text:
                    yield text


def complete_with_tools(config: dict, messages: list, tools: list,
                        system: str = None, max_tokens: int = 4096) -> dict:
    """One model turn with tool support. Returns a normalized dict:
    {
      "stop_reason": "tool_use" | "end_turn",
      "content":     provider-native content (list of blocks), for history replay,
      "text":        concatenated text blocks,
      "tool_calls":  [{"id": ..., "name": ..., "input": {...}}, ...],
      "usage":       {"input_tokens": ..., "output_tokens": ..., "cache_read_input_tokens": ...},
    }
    """
    api_key, model = _credentials(config)
    body = {
        "model":      model,
        "max_tokens": max_tokens,
        "messages":   messages,
    }
    # Omit tools key entirely when empty — Anthropic rejects tools:[].
    if tools:
        body["tools"] = tools
    # cache_control on the system prompt — re-sent every iteration, cached reads
    # cost ~0.1× input price, the biggest cost lever in a loop.
    if system:
        body["system"] = [{"type": "text", "text": system,
                           "cache_control": {"type": "ephemeral"}}]

    with urllib.request.urlopen(_post(api_key, body), timeout=_TIMEOUT) as resp:
        data = json.loads(resp.read())

    content = data.get("content", [])
    text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
    tool_calls = [
        {"id": b["id"], "name": b["name"], "input": b.get("input", {})}
        for b in content if b.get("type") == "tool_use"
    ]
    raw_usage = data.get("usage", {})
    return {
        "stop_reason": data.get("stop_reason", "end_turn"),
        "content":     content,
        "text":        text,
        "tool_calls":  tool_calls,
        "usage": {
            "input_tokens":            raw_usage.get("input_tokens", 0),
            "output_tokens":           raw_usage.get("output_tokens", 0),
            "cache_read_input_tokens": raw_usage.get("cache_read_input_tokens", 0),
        },
    }


def make_assistant_message(result: dict) -> dict:
    """Build the assistant history entry from a complete_with_tools result."""
    return {"role": "assistant", "content": result["content"]}


def make_tool_result_message(tool_results: list) -> list:
    """Build the tool-result user message(s) from a list of
    {"id": ..., "content": ..., "is_error": ...} dicts.
    Returns a list containing exactly one message (Anthropic batches them).
    """
    blocks = [
        {
            "type":        "tool_result",
            "tool_use_id": r["id"],
            "content":     r["content"],
            **({"is_error": True} if r.get("is_error") else {}),
        }
        for r in tool_results
    ]
    return [{"role": "user", "content": blocks}]
