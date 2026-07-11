"""Provider catalog and defaults, shared without transport dependencies."""

from __future__ import annotations

PROVIDERS = {
    "OpenAI": {
        "base_url": "https://api.openai.com/v1",
        # Curated fallback for offline / unkeyed startup. The live
        # /models endpoint is the source of truth â€” click "Refresh
        # Models" in Settings to replace this list.
        "models": [
            # Current flagship
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4.1-nano",
            # 4o family (still in wide use)
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4-turbo",
            # Reasoning
            "o3",
            "o3-mini",
            "o4-mini",
            "o1",
            "o1-mini",
        ],
        "default_model": "gpt-4.1-mini",
        "requires_base_url": False,
        "transport": "openai",
        "label": "OpenAI",
        "hint": "Official OpenAI Chat Completions API (ChatGPT models). "
        "Uses api.openai.com by default. Click 'Refresh Models' to "
        "pull the live list from your account.",
    },
    "Codex": {
        "base_url": "",
        # Account-visible models are fetched from Codex app-server's
        # model/list endpoint. Never hard-code a model catalog here.
        "models": [],
        "default_model": "",
        "requires_base_url": False,
        "requires_api_key": False,
        "transport": "codex_cli",
        "label": "Codex (ChatGPT login)",
        "hint": "Uses your existing Codex ChatGPT login and Codex plan usageâ€”not an API key. "
        "Available models are fetched live from your account. Tawreed never stores or copies "
        "the Codex token; classification runs read-only and requires review before export.",
    },
    "Google": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "models": [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-1.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-flash-8b",
        ],
        "default_model": "gemini-2.5-flash",
        "requires_base_url": False,
        "transport": "openai_compat",
        "label": "Google Gemini",
        "hint": "Uses the OpenAI-compatible Gemini endpoint. "
        "'Refresh Models' lists everything available on the Google Generative AI API.",
    },
    "Claude": {
        "base_url": "https://api.anthropic.com/v1",
        "models": [
            "claude-sonnet-4-5",
            "claude-sonnet-4-20250514",
            "claude-3-7-sonnet-20250219",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
        ],
        "default_model": "claude-sonnet-4-5",
        "requires_base_url": False,
        "transport": "native_anthropic",
        "label": "Anthropic Claude",
        "hint": "Native Anthropic Messages API. 'Refresh Models' queries the live /v1/models endpoint.",
    },
    "OpenAI Compatible": {
        # Catch-all for any service that speaks the OpenAI Chat
        # Completions protocol: local inference servers (LM Studio,
        # vLLM, llama.cpp, Ollama), or third-party hosted endpoints.
        # No curated models â€” the user picks / types a model name,
        # and 'Refresh Models' hits {base_url}/models if the endpoint
        # implements it.
        "base_url": "",
        "models": [],
        "default_model": "",
        "requires_base_url": True,
        "transport": "openai",
        "label": "OpenAI Compatible",
        "hint": "Use this for any OpenAI-protocol service â€” local servers "
        "(LM Studio, vLLM, llama.cpp, Ollama) or hosted providers "
        "(MiniMax, Groq, Together, etc.). Set the Base URL, paste "
        "an API key if the service requires one, then click "
        "'Refresh Models' to auto-detect the available models.",
    },
}


def get_provider_names() -> list:
    """Return the list of supported provider keys, in display order."""
    return list(PROVIDERS.keys())


def get_provider_config(name: str) -> dict:
    """Return the full provider config for a given name.

    Raises KeyError if the name is not a recognised provider. Callers
    should validate user input via `is_valid_provider()` first.
    """
    return PROVIDERS[name]


def is_valid_provider(name: str) -> bool:
    """True if `name` is a key in the PROVIDERS dict."""
    return name in PROVIDERS


def get_default_settings() -> dict:
    """Return a complete default settings dict using the default provider."""
    default_provider = "Codex"
    p = PROVIDERS[default_provider]
    return {
        "provider": default_provider,
        "api_key": "",
        "model": p["default_model"],
        "base_url": p["base_url"],
        "language": "en",
        "theme": "system",
    }


__all__ = [
    "PROVIDERS",
    "get_default_settings",
    "get_provider_config",
    "get_provider_names",
    "is_valid_provider",
]
