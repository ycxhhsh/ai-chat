"""Unit tests conftest — 覆盖 session-scoped DB fixtures。

纯函数测试不需要数据库，跳过表创建避免 JSONB/SQLite 不兼容。
"""
import pytest_asyncio


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_database():
    """覆盖根 conftest 的 setup_database，跳过 create_all。"""
    yield
