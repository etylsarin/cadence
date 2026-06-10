"""OpenAI provider — complete() and stream() implementations."""

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
