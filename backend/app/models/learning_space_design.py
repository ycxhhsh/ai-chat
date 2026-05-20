"""学习空间设计模块的数据模型。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.models.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LearningSpaceQuestion(Base):
    __tablename__ = "learning_space_questions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    stage_name: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled_steps: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    ai_round_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    min_words_step1: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    min_words_step3: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    min_words_step5: Mapped[int] = mapped_column(Integer, nullable=False, default=80)
    allow_ai_acceleration: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    created_by: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class LearningSpaceSession(Base):
    __tablename__ = "learning_space_sessions"
    __table_args__ = (
        UniqueConstraint(
            "question_id", "student_id", name="uq_learning_space_question_student"
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    question_id: Mapped[str] = mapped_column(
        ForeignKey("learning_space_questions.id"), nullable=False, index=True
    )
    student_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    group_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    current_step: Mapped[str] = mapped_column(String(50), nullable=False)
    current_step_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")
    used_acceleration: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class LearningSpaceEntry(Base):
    __tablename__ = "learning_space_entries"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "step_key", name="uq_learning_space_session_step_entry"
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("learning_space_sessions.id"), nullable=False, index=True
    )
    step_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class LearningSpaceRevision(Base):
    __tablename__ = "learning_space_revisions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    entry_id: Mapped[str] = mapped_column(
        ForeignKey("learning_space_entries.id"), nullable=False, index=True
    )
    old_content: Mapped[str] = mapped_column(Text, nullable=False)
    new_content: Mapped[str] = mapped_column(Text, nullable=False)
    edited_by: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    edited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class LearningSpaceMessage(Base):
    __tablename__ = "learning_space_messages"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("learning_space_sessions.id"), nullable=False, index=True
    )
    step_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    round_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class LearningSpaceAccelerationCheck(Base):
    __tablename__ = "learning_space_acceleration_checks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("learning_space_sessions.id"), nullable=False, index=True
    )
    step_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_next_step: Mapped[str | None] = mapped_column(String(50), nullable=True)
    adopted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
