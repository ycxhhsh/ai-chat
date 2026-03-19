"""Job 模型 — 异步后台任务的状态追踪。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, JSON

from app.models.base import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False, index=True)
    session_id = Column(String(100), nullable=True)
    type = Column(String(50), nullable=False, default="deep_search")  # deep_search, ...
    status = Column(String(20), nullable=False, default="pending")  # pending/running/done/failed
    title = Column(String(200), nullable=False, default="")
    input_data = Column(JSON, nullable=True)
    result = Column(JSON, nullable=True)
    progress = Column(Integer, nullable=False, default=0)  # 0-100
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
