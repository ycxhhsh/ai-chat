"""Notification 模型 — 站内通知。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey

from app.models.base import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False, index=True)
    type = Column(String(50), nullable=False, default="job_done")  # job_done, system, ...
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
