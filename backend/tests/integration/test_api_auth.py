"""认证 API 集成测试。"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestRegister:
    """POST /auth/register"""

    async def test_register_student(self, async_client: AsyncClient):
        resp = await async_client.post("/auth/register", json={
            "email": "reg_student@test.com",
            "password": "password123",
            "name": "学生A",
            "role": "student",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["role"] == "student"
        assert data["user"]["name"] == "学生A"

    async def test_register_teacher(self, async_client: AsyncClient):
        resp = await async_client.post("/auth/register", json={
            "email": "reg_teacher@test.com",
            "password": "password123",
            "name": "教师B",
            "role": "teacher",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["role"] == "teacher"

    async def test_duplicate_email_409(self, async_client: AsyncClient):
        email = "dup@test.com"
        # 第一次注册
        await async_client.post("/auth/register", json={
            "email": email, "password": "pw", "name": "A", "role": "student",
        })
        # 第二次重复注册
        resp = await async_client.post("/auth/register", json={
            "email": email, "password": "pw", "name": "B", "role": "student",
        })
        assert resp.status_code == 409

    async def test_invalid_role_400(self, async_client: AsyncClient):
        resp = await async_client.post("/auth/register", json={
            "email": "badrole@test.com",
            "password": "pw",
            "name": "C",
            "role": "admin",
        })
        assert resp.status_code == 400


@pytest.mark.asyncio
class TestLogin:
    """POST /auth/login"""

    async def test_login_success(self, async_client: AsyncClient):
        # 先注册
        await async_client.post("/auth/register", json={
            "email": "login_ok@test.com",
            "password": "secret",
            "name": "登录用户",
            "role": "student",
        })
        # 再登录
        resp = await async_client.post("/auth/login", json={
            "email": "login_ok@test.com",
            "password": "secret",
        })
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_wrong_password_401(self, async_client: AsyncClient):
        await async_client.post("/auth/register", json={
            "email": "login_fail@test.com",
            "password": "correct",
            "name": "X",
            "role": "student",
        })
        resp = await async_client.post("/auth/login", json={
            "email": "login_fail@test.com",
            "password": "wrong",
        })
        assert resp.status_code == 401

    async def test_nonexistent_user_401(self, async_client: AsyncClient):
        resp = await async_client.post("/auth/login", json={
            "email": "nobody@test.com",
            "password": "pw",
        })
        assert resp.status_code == 401


@pytest.mark.asyncio
class TestGetMe:
    """GET /auth/me"""

    async def test_get_me_with_valid_token(self, async_client: AsyncClient):
        reg = await async_client.post("/auth/register", json={
            "email": "me_test@test.com",
            "password": "pw",
            "name": "我自己",
            "role": "student",
        })
        token = reg.json()["access_token"]
        resp = await async_client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "me_test@test.com"

    async def test_get_me_without_token_401(self, async_client: AsyncClient):
        resp = await async_client.get("/auth/me")
        assert resp.status_code in (401, 403)
