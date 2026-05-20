"""Pytest 全局 fixtures：内存 SQLite + 测试用 FastAPI app。"""
from __future__ import annotations

import os
from contextlib import suppress
from pathlib import Path
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

# ── 强制使用内存 SQLite，避免污染真实 DB ──
_TEST_DB_PATH = Path(__file__).resolve().parents[1] / ".pytest_cothink.sqlite3"
_TEST_DB_URL = f"sqlite+aiosqlite:///{_TEST_DB_PATH.as_posix()}"
os.environ["DB_URL"] = _TEST_DB_URL
os.environ["REDIS_URL"] = ""
os.environ["DEEPSEEK_API_KEY"] = "test-key-not-real"


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_type, _compiler, **_kw):  # noqa: ANN001, ANN202
    return "JSON"

from app.core.config import get_settings  # noqa: E402
from app.core.dependencies import get_db  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models.base import Base  # noqa: E402
from app.main import app  # noqa: E402

# ── 清除 lru_cache，确保测试配置生效 ──
get_settings.cache_clear()

# ── 测试用内存数据库引擎 ──
_test_engine = create_async_engine(
    _TEST_DB_URL,
    echo=False,
    poolclass=NullPool,
)
_TestSessionLocal = async_sessionmaker(
    _test_engine, class_=AsyncSession, expire_on_commit=False,
)


async def _override_get_db() -> AsyncIterator[AsyncSession]:
    async with _TestSessionLocal() as session:
        yield session


# 覆盖依赖
app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_database():
    """创建所有表（一次性）。"""
    # 确保所有模型被导入
    import app.models  # noqa: F401

    with suppress(FileNotFoundError):
        _TEST_DB_PATH.unlink()

    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await _test_engine.dispose()
    with suppress(FileNotFoundError, PermissionError):
        _TEST_DB_PATH.unlink()


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """提供一个独立的数据库会话。"""
    async with _TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def async_client() -> AsyncIterator[AsyncClient]:
    """提供一个绑定到测试 app 的 httpx 异步客户端。"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ── 便捷 token fixtures ──


@pytest.fixture
def sample_token() -> str:
    """生成一个测试用 JWT token。"""
    return create_access_token({"sub": "test-user-id"})


@pytest.fixture
def sample_password_hash() -> str:
    return hash_password("test123")


async def _get_token(
    client: AsyncClient, email: str, password: str, name: str, role: str,
) -> str:
    """注册用户并返回 token；若邮箱已存在则改为登录。"""
    resp = await client.post("/auth/register", json={
        "email": email, "password": password, "name": name, "role": role,
    })
    if resp.status_code == 409:
        resp = await client.post("/auth/login", json={
            "email": email, "password": password,
        })
    return resp.json().get("access_token", "")


@pytest_asyncio.fixture
async def teacher_token(async_client: AsyncClient) -> str:
    """注册/登录一个教师并返回其 token。"""
    return await _get_token(
        async_client, "teacher@test.com", "pass123", "测试教师", "teacher",
    )


@pytest_asyncio.fixture
async def student_token(async_client: AsyncClient) -> str:
    """注册/登录一个学生并返回其 token。"""
    return await _get_token(
        async_client, "student@test.com", "pass123", "测试学生", "student",
    )
