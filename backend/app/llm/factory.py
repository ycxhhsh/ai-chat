"""LLM 客户端工厂。根据 provider 名称返回对应客户端。"""
from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.llm.base import BaseLLMClient
from app.llm.openai_compat import OpenAICompatibleClient

# Provider 配置注册表
_PROVIDER_REGISTRY: dict[str, dict[str, str]] = {
    "deepseek": {
        "key_field": "deepseek_api_key",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    "kimi": {
        "key_field": "kimi_api_key",
        "base_url": "https://api.moonshot.cn/v1",
        "model": "kimi-k2-turbo-preview",
    },
    "doubao": {
        "key_field": "doubao_api_key",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seed-2-0-mini-260215",
    },
    "zhipu": {
        "key_field": "zhipu_api_key",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4-flash",
    },
    "tongyi": {
        "key_field": "tongyi_api_key",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
    },
    "openai": {
        "key_field": "openai_api_key",
        "base_url": "https://api.openai.com",
        "model": "gpt-4o-mini",
    },
    "gemini": {
        "key_field": "gemini_api_key",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.0-flash",
    },
    "claude": {
        "key_field": "claude_api_key",
        "base_url": "https://api.anthropic.com",
        "model": "claude-3-5-haiku-latest",
    },
}


# 客户端缓存池：复用已创建的 LLM 客户端（含 HTTP 连接池）
_client_cache: dict[tuple[str, float], BaseLLMClient] = {}


def get_llm_client(
    provider_name: str = "deepseek",
    timeout: float | None = None,
) -> BaseLLMClient:
    """根据 provider 名称返回 LLM 客户端实例（缓存复用）。"""
    settings = get_settings()
    provider_name = provider_name.lower()

    if provider_name not in _PROVIDER_REGISTRY:
        raise ValueError(
            f"Unknown LLM provider: {provider_name}. "
            f"Available: {list(_PROVIDER_REGISTRY.keys())}"
        )

    cfg = _PROVIDER_REGISTRY[provider_name]
    api_key = getattr(settings, cfg["key_field"], "")

    if not api_key:
        raise ValueError(
            f"API key not configured for provider: {provider_name}. "
            f"Set {cfg['key_field'].upper()} in .env"
        )

    effective_timeout = timeout or settings.llm_stream_timeout_s
    cache_key = (provider_name, effective_timeout)

    if cache_key not in _client_cache:
        _client_cache[cache_key] = OpenAICompatibleClient(
            api_key=api_key,
            base_url=cfg["base_url"],
            default_model=cfg["model"],
            timeout=effective_timeout,
        )

    return _client_cache[cache_key]


def get_available_providers() -> list[dict[str, str]]:
    """返回当前已配置 API Key 的可用 Provider 列表。"""
    settings = get_settings()
    available = []
    for name, cfg in _PROVIDER_REGISTRY.items():
        api_key = getattr(settings, cfg["key_field"], "")
        if api_key:
            available.append({
                "name": name,
                "display_name": name.capitalize(),
                "model": cfg["model"],
            })
    return available
