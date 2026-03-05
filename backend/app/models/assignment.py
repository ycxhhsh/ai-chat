"""作业模型。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Assignment(Base):
    __tablename__ = "assignments"

    assignment_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, index=True, nullable=False
    )
    student_id: Mapped[str] = mapped_column(
        String, index=True, nullable=False
    )
    content: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    file_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    ai_review: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    teacher_review: Mapped[Optional[dict]] = mapped_column(
        JSON, nullable=True
    )
    status: Mapped[str] = mapped_column(
        String, default="submitted", nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
