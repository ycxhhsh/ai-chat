"""LLM 客户端抽象基类。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any


class BaseLLMClient(ABC):
    """所有 LLM Provider 的统一接口。"""

    @abstractmethod
    async def stream_chat(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """流式生成回复，逐 chunk yield 文本。"""
        ...
