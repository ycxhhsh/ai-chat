"""作业模型。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
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
    task_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("assignment_tasks.task_id"), index=True, nullable=True
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

    __table_args__ = (
        UniqueConstraint("task_id", "student_id", name="uq_assignment_task_student"),
    )


class AssignmentTask(Base):
    __tablename__ = "assignment_tasks"

    task_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default="published", nullable=False
    )
    peer_review_count: Mapped[int] = mapped_column(
        Integer, default=5, nullable=False
    )
    created_by: Mapped[str] = mapped_column(String, index=True, nullable=False)
    peer_review_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
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


class AssignmentTaskTarget(Base):
    __tablename__ = "assignment_task_targets"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    task_id: Mapped[str] = mapped_column(
        ForeignKey("assignment_tasks.task_id"), index=True, nullable=False
    )
    student_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint("task_id", "student_id", name="uq_assignment_task_target"),
    )


class AssignmentSelfReview(Base):
    __tablename__ = "assignment_self_reviews"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    task_id: Mapped[str] = mapped_column(
        ForeignKey("assignment_tasks.task_id"), index=True, nullable=False
    )
    assignment_id: Mapped[str] = mapped_column(
        ForeignKey("assignments.assignment_id"), index=True, nullable=False
    )
    student_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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

    __table_args__ = (
        UniqueConstraint("task_id", "student_id", name="uq_self_review_task_student"),
    )


class AssignmentPeerReview(Base):
    __tablename__ = "assignment_peer_reviews"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    task_id: Mapped[str] = mapped_column(
        ForeignKey("assignment_tasks.task_id"), index=True, nullable=False
    )
    assignment_id: Mapped[str] = mapped_column(
        ForeignKey("assignments.assignment_id"), index=True, nullable=False
    )
    reviewer_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    reviewee_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default="assigned", nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "reviewer_id",
            "assignment_id",
            name="uq_peer_review_task_reviewer_assignment",
        ),
    )
