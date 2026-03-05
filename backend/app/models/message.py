"""消息模型。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Message(Base):
    __tablename__ = "messages"

    message_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, index=True, nullable=False
    )
    # NULL = 公共消息；非 NULL = 私聊（含 AI 回复）
    recipient_id: Mapped[Optional[str]] = mapped_column(
        String, index=True, nullable=True
    )
    # AI 对话会话 ID（NULL = 小组消息，非 NULL = AI 对话消息）
    conversation_id: Mapped[Optional[str]] = mapped_column(
        String(36), index=True, nullable=True
    )
    sender: Mapped[dict] = mapped_column(JSON, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    timing: Mapped[dict] = mapped_column(JSON, nullable=False)
    metadata_info: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict
    )
    # embedding 暂存为 JSON 纯文本（SQLite 无 pgvector）
    embedding: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
