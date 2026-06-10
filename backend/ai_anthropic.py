"""Anthropic provider — complete() and stream() implementations."""

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
