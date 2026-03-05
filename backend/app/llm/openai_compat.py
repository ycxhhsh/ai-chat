"""OpenAI 兼容协议客户端 — 复用 HTTP 连接池。

DeepSeek / Kimi / 智谱 / 通义 / 豆包 等均支持 OpenAI 兼容 API，
只需不同的 base_url、api_key 和 model_name。
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.llm.base import BaseLLMClient


class OpenAICompatibleClient(BaseLLMClient):
    """通用 OpenAI 兼容协议的流式聊天客户端。

    核心优化：复用 httpx.AsyncClient，避免每次请求都重新 TLS 握手。
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        default_model: str,
        timeout: float = 60.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._default_model = default_model
        # 分离超时设置：连接 5 秒，读取（流式）用总超时
        self._timeout = httpx.Timeout(
            connect=5.0,
            read=timeout,
            write=10.0,
            pool=10.0,
        )
        self._headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        # 复用连接池，避免重复 TLS 握手
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        """懒初始化并复用 httpx 客户端。"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                    keepalive_expiry=120,
                ),
                http2=True,
            )
        return self._client

    async def stream_chat(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        # 智能拼接 URL：base_url 末尾含版本路径时直接追加 /chat/completions
        base = self._base_url
        if base.rstrip("/").split("/")[-1] in ("v1", "v2", "v3", "v4"):
            url = f"{base}/chat/completions"
        else:
            url = f"{base}/v1/chat/completions"
        payload: dict[str, Any] = {
            "model": model or self._default_model,
            "messages": messages,
            "stream": True,
            "temperature": temperature,
        }

        client = self._get_client()
        async with client.stream(
            "POST", url, headers=self._headers, json=payload
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue

                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break

                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"]
                    content = delta.get("content")
                    if content:
                        yield content
                except Exception:
                    continue

    async def close(self) -> None:
        """关闭 HTTP 连接池。"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
