"""教师端 API 集成测试。"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
class TestTeacherStats:
    """GET /teacher/stats"""

    async def test_teacher_can_get_stats(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.get(
            "/teacher/stats", headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "student_count" in data
        assert "message_count" in data
        assert "group_count" in data

    async def test_student_cannot_get_stats(
        self, async_client: AsyncClient, student_token: str,
    ):
        resp = await async_client.get(
            "/teacher/stats", headers=_auth(student_token),
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
class TestTeacherStudents:
    """GET /teacher/students"""

    async def test_list_students(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.get(
            "/teacher/students", headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "students" in data
        assert "total" in data

    async def test_student_cannot_list_students(
        self, async_client: AsyncClient, student_token: str,
    ):
        resp = await async_client.get(
            "/teacher/students", headers=_auth(student_token),
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
class TestTeacherMessages:
    """GET /teacher/messages"""

    async def test_list_messages(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.get(
            "/teacher/messages", headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "messages" in data
        assert "total" in data


@pytest.mark.asyncio
class TestTeacherAnalytics:
    """GET /teacher/analytics"""

    async def test_analytics(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.get(
            "/teacher/analytics", headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "participation_curve" in data
        assert "ai_intervention_rate" in data
        assert "scaffold_heatmap" in data

    async def test_student_cannot_get_analytics(
        self, async_client: AsyncClient, student_token: str,
    ):
        resp = await async_client.get(
            "/teacher/analytics", headers=_auth(student_token),
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
class TestTeacherExport:
    """GET /teacher/export/messages"""

    async def test_export_csv(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.get(
            "/teacher/export/messages", headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")


@pytest.mark.asyncio
class TestObservability:
    """可观测性端点"""

    async def test_healthz(self, async_client: AsyncClient):
        resp = await async_client.get("/healthz")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    async def test_readyz(self, async_client: AsyncClient):
        resp = await async_client.get("/readyz")
        # 可能 ready 或 503, 取决于 DB
        assert resp.status_code in (200, 503)

    async def test_metrics(self, async_client: AsyncClient):
        resp = await async_client.get("/metrics")
        assert resp.status_code == 200
        assert "cothink_uptime_seconds" in resp.text


@pytest.mark.asyncio
class TestAssignments:
    """作业 API"""

    async def test_submit_and_list(
        self, async_client: AsyncClient, student_token: str,
    ):
        # 提交作业
        resp = await async_client.post(
            "/assignments",
            json={
                "session_id": "test-session",
                "student_id": "test-student",
                "content": "这是我的批判性思维作业",
            },
            headers=_auth(student_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "assignment_id" in data

        # 按 session 查
        resp2 = await async_client.get(
            "/assignments/by-session/test-session",
            headers=_auth(student_token),
        )
        assert resp2.status_code == 200
        assert len(resp2.json()) >= 1


@pytest.mark.asyncio
class TestCourses:
    """课程管理 API"""

    async def test_create_course(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.post(
            "/courses",
            json={"name": "测试课程", "description": "测试描述"},
            headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "course_id" in data
        assert "invite_code" in data

    async def test_list_courses(
        self, async_client: AsyncClient, teacher_token: str,
    ):
        resp = await async_client.get(
            "/courses", headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_student_cannot_create(
        self, async_client: AsyncClient, student_token: str,
    ):
        resp = await async_client.post(
            "/courses",
            json={"name": "不该创建"},
            headers=_auth(student_token),
        )
        assert resp.status_code == 403
