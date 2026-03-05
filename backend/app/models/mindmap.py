"""思维导图模型。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MindMap(Base):
    __tablename__ = "mindmaps"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, index=True, nullable=False
    )
    # [{id, label, x, y, type, ...}]
    nodes: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    # [{id, source, target, label, ...}]
    edges: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)

    created_by: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
