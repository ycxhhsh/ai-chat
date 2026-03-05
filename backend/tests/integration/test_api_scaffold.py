"""支架 API 集成测试。"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
class TestScaffoldCRUD:
    """支架 CRUD + 权限校验。"""

    async def test_teacher_create_scaffold(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.post(
            "/scaffolds",
            json={
                "display_name": "测试支架",
                "prompt_template": "请用 {concept} 解释",
                "is_active": True,
                "sort_order": 1,
            },
            headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["display_name"] == "测试支架"
        assert "scaffold_id" in data

    async def test_list_scaffolds(
        self, async_client: AsyncClient,
    ):
        # 无需认证即可列出支架
        resp = await async_client.get("/scaffolds")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_teacher_update_scaffold(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        # 先创建
        create_resp = await async_client.post(
            "/scaffolds",
            json={
                "display_name": "待更新",
                "prompt_template": "原始模板",
            },
            headers=_auth(teacher_token),
        )
        sid = create_resp.json()["scaffold_id"]

        # 更新
        resp = await async_client.patch(
            f"/scaffolds/{sid}",
            json={"display_name": "已更新"},
            headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "已更新"

    async def test_student_cannot_create_scaffold(
        self, async_client: AsyncClient, student_token: str,
    ):
        resp = await async_client.post(
            "/scaffolds",
            json={
                "display_name": "非法",
                "prompt_template": "xxx",
            },
            headers=_auth(student_token),
        )
        assert resp.status_code == 403
