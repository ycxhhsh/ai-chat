"""异步数据库会话管理。"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_settings = get_settings()

_engine_kwargs: dict = {"echo": False}

if not _settings.db_url.startswith("sqlite"):
    # PostgreSQL 连接池配置（生产环境）
    _engine_kwargs.update(
        pool_pre_ping=True,
        pool_size=20,
        max_overflow=30,
        pool_recycle=1800,
    )

engine = create_async_engine(_settings.db_url, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)
