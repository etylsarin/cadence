"""OpenAI provider — complete(), stream(), and complete_with_tools() implementations."""

import json
import urllib.request

_URL = "https://api.openai.com/v1/chat/completions"
_TIMEOUT = 120  # seconds — generous for LLM latency, but never hang forever
_DEFAULT_MODEL = "gpt-4o"  # used when AI_MODEL is not set


def _credentials(config: dict) -> tuple[str, str]:
    api_key = config.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set")
    model = config.get("AI_MODEL") or _DEFAULT_MODEL
    return api_key, model


def _post(api_key: str, body: dict) -> urllib.request.Request:
    return urllib.request.Request(
        _URL,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )


def _body(model: str, messages: list, system: str, max_tokens: int, stream: bool) -> dict:
    msgs = ([{"role": "system", "content": system}] if system else []) + messages
    body = {"model": model, "max_tokens": max_tokens, "messages": msgs}
    if stream: body["stream"] = True
    return body


def complete(config: dict, messages: list, system: str = None, max_tokens: int = 4096) -> str:
    api_key, model = _credentials(config)
    with urllib.request.urlopen(_post(api_key, _body(model, messages, system, max_tokens, stream=False)), timeout=_TIMEOUT) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"]


def stream(config: dict, messages: list, system: str = None, max_tokens: int = 2048):
    api_key, model = _credentials(config)
    with urllib.request.urlopen(_post(api_key, _body(model, messages, system, max_tokens, stream=True)), timeout=_TIMEOUT) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8").rstrip()
            if not line.startswith("data: "):
                continue
            data_str = line[6:]
            if data_str == "[DONE]":
                return
            try:
                event = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            text = ((event.get("choices") or [{}])[0].get("delta", {}).get("content", ""))
            if text:
                yield text


def complete_with_tools(config: dict, messages: list, tools: list,
                        system: str = None, max_tokens: int = 4096) -> dict:
    """One model turn with tool support. Returns the same normalized dict shape
    as ai_anthropic.complete_with_tools so agent.py stays provider-agnostic.
    """
    api_key, model = _credentials(config)
    # OpenAI tool schema: {type: "function", function: {name, description, parameters}}
    oai_tools = [
        {
            "type": "function",
            "function": {
                "name":        t["name"],
                "description": t.get("description", ""),
                "parameters":  t.get("input_schema", {"type": "object", "properties": {}}),
            },
        }
        for t in tools
    ]
    msgs = ([{"role": "system", "content": system}] if system else []) + messages
    body: dict = {"model": model, "max_tokens": max_tokens, "messages": msgs}
    # Omit tools key entirely when empty — OpenAI rejects tools:[].
    if oai_tools:
        body["tools"] = oai_tools

    with urllib.request.urlopen(_post(api_key, body), timeout=_TIMEOUT) as resp:
        data = json.loads(resp.read())

    choice  = (data.get("choices") or [{}])[0]
    message = choice.get("message", {})
    finish  = choice.get("finish_reason", "stop")

    text = message.get("content") or ""
    raw_tcs = message.get("tool_calls") or []
    tool_calls = [
        {
            "id":    tc.get("id", ""),
            "name":  (tc.get("function") or {}).get("name", ""),
            "input": json.loads((tc.get("function") or {}).get("arguments", "{}") or "{}"),
        }
        for tc in raw_tcs
    ]
    raw_usage = data.get("usage", {})
    return {
        "stop_reason": "tool_use" if finish == "tool_calls" else "end_turn",
        "content":     message,   # full message dict — replayed by make_assistant_message
        "text":        text,
        "tool_calls":  tool_calls,
        "usage": {
            "input_tokens":            raw_usage.get("prompt_tokens", 0),
            "output_tokens":           raw_usage.get("completion_tokens", 0),
            "cache_read_input_tokens": 0,
        },
    }


def make_assistant_message(result: dict) -> dict:
    """Build the assistant history entry from a complete_with_tools result."""
    return result["content"]   # already a {role, content, tool_calls} dict


def make_tool_result_message(tool_results: list) -> list:
    """Build tool-result messages from {"id", "content", "is_error"} dicts.
    OpenAI uses one message per tool call, all with role "tool".
    """
    return [
        {"role": "tool", "tool_call_id": r["id"], "content": r["content"]}
        for r in tool_results
    ]
