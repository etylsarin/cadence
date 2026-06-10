"""AI router — dispatches to ai_anthropic or ai_openai.

AI_PROVIDER is optional: when it's blank the provider is auto-detected from
whichever API key is present (Anthropic wins if both are set), matching what
README / .env.example promise. AI_MODEL is also optional — each provider module
falls back to a sensible default model. Set either explicitly to override.
Only a total absence of both API keys raises ValueError.
"""


def _provider(config: dict):
    provider = (config.get("AI_PROVIDER") or "").strip().lower()
    # Auto-detect from whichever API key is present (Anthropic takes priority).
    if not provider:
        if config.get("ANTHROPIC_API_KEY"):
            provider = "anthropic"
        elif config.get("OPENAI_API_KEY"):
            provider = "openai"
    if provider == "anthropic":
        import ai_anthropic
        return ai_anthropic
    if provider == "openai":
        import ai_openai
        return ai_openai
    if provider == "mock":
        # Offline demo provider (deterministic canned output) — see ai_mock.py.
        import ai_mock
        return ai_mock
    raise ValueError(
        "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY "
        "(the provider is auto-detected), or set AI_PROVIDER to 'anthropic' or "
        f"'openai' explicitly (got AI_PROVIDER={provider!r})."
    )


def complete(config: dict, messages: list, system: str = None, max_tokens: int = 4096) -> str:
    return _provider(config).complete(config, messages, system=system, max_tokens=max_tokens)


def stream(config: dict, messages: list, system: str = None, max_tokens: int = 2048):
    yield from _provider(config).stream(config, messages, system=system, max_tokens=max_tokens)


def complete_with_tools(config: dict, messages: list, tools: list,
                        system: str = None, max_tokens: int = 4096) -> dict:
    return _provider(config).complete_with_tools(
        config, messages, tools, system=system, max_tokens=max_tokens)


def make_assistant_message(config: dict, result: dict) -> dict:
    return _provider(config).make_assistant_message(result)


def make_tool_result_message(config: dict, tool_results: list) -> list:
    return _provider(config).make_tool_result_message(tool_results)
