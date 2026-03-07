"""对话摘要模型 — 跨窗口轻量记忆。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ConversationSummary(Base):
    """存储每个对话窗口的一句话摘要，用于跨窗口上下文注入。"""

    __tablename__ = "conversation_summaries"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String, index=True, nullable=False
    )
    conversation_id: Mapped[str] = mapped_column(
        String(36), nullable=False, unique=True
    )
    summary: Mapped[str] = mapped_column(
        Text, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
