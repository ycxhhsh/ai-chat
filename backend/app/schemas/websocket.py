"""WebSocket 事件 Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel


class WSEvent(BaseModel):
    event: str
    request_id: Optional[UUID] = None
    ts: Optional[datetime] = None
    data: dict[str, Any] = {}


class ChatMetadata(BaseModel):
    is_scaffold_used: bool = False
    scaffold_info: Optional[dict[str, str]] = None
    is_deep_thinking: bool = False
    mentions: list[str] = []


class ChatSendPayload(BaseModel):
    content: str
    content_type: str = "text"
    target_user: Optional[str] = None
    metadata: ChatMetadata = ChatMetadata()
    llm_provider: Optional[str] = None  # 学生选择的 LLM 模型
