"""教师端 API 集成测试。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from app.models.message import Message


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_user(
    client: AsyncClient,
    role: str,
    name: str,
) -> tuple[str, dict]:
    suffix = uuid.uuid4().hex[:10]
    resp = await client.post(
        "/auth/register",
        json={
            "email": f"{role}-{suffix}@test.com",
            "password": "pass123",
            "name": name,
            "role": role,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    return data["access_token"], data["user"]


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
        self, async_client: AsyncClient, teacher_token: str, db_session,
    ):
        now = datetime.now(timezone.utc)
        db_session.add_all([
            Message(
                message_id=f"analytics-student-{uuid.uuid4()}",
                session_id="analytics-group",
                sender={
                    "id": "analytics-student",
                    "name": "分析学生",
                    "role": "student",
                },
                content="我认为这个学习空间需要兼顾协作讨论和独立思考。",
                timing={"absolute_time": now.isoformat(), "relative_minute": 0},
                metadata_info={
                    "is_scaffold_used": True,
                    "scaffold_info": {"name": "证据支架"},
                    "is_mindmap_extraction": True,
                    "mindmap_node_count": 4,
                },
                created_at=now,
            ),
            Message(
                message_id=f"analytics-ai-{uuid.uuid4()}",
                session_id="analytics-group",
                recipient_id="analytics-student",
                sender={"id": "ai", "name": "AI", "role": "ai"},
                content="你可以进一步说明协作区和独立区的边界条件。",
                timing={"absolute_time": now.isoformat(), "relative_minute": 1},
                metadata_info={},
                created_at=now,
            ),
            Message(
                message_id=f"analytics-student2-a-{uuid.uuid4()}",
                session_id="analytics-group",
                sender={
                    "id": "analytics-student-2",
                    "name": "Analytics Student 2",
                    "role": "student",
                },
                content="Second student message A",
                timing={"absolute_time": now.isoformat(), "relative_minute": 2},
                metadata_info={},
                created_at=now,
            ),
            Message(
                message_id=f"analytics-student2-b-{uuid.uuid4()}",
                session_id="analytics-group",
                sender={
                    "id": "analytics-student-2",
                    "name": "Analytics Student 2",
                    "role": "student",
                },
                content="Second student message B",
                timing={"absolute_time": now.isoformat(), "relative_minute": 3},
                metadata_info={},
                created_at=now,
            ),
            Message(
                message_id=f"analytics-student2-c-{uuid.uuid4()}",
                session_id="analytics-group",
                sender={
                    "id": "analytics-student-2",
                    "name": "Analytics Student 2",
                    "role": "student",
                },
                content="Second student message C",
                timing={"absolute_time": now.isoformat(), "relative_minute": 4},
                metadata_info={},
                created_at=now,
            ),
            Message(
                message_id=f"analytics-ai2-{uuid.uuid4()}",
                session_id="analytics-group",
                recipient_id="analytics-student-2",
                sender={"id": "ai", "name": "AI", "role": "ai"},
                content="AI response to second student",
                timing={"absolute_time": now.isoformat(), "relative_minute": 5},
                metadata_info={},
                created_at=now,
            ),
        ])
        await db_session.commit()

        resp = await async_client.get(
            "/teacher/analytics", headers=_auth(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "participation_trend" in data
        assert "ai_intervention_rate" in data
        assert "scaffold_usage" in data
        ai_rows = {
            row["user_id"]: row
            for row in data["ai_intervention_rate"]
            if row["user_id"] in {"analytics-student", "analytics-student-2"}
        }
        assert ai_rows["analytics-student"]["ai_ratio"] == 50.0
        assert ai_rows["analytics-student-2"]["ai_ratio"] == 25.0
        assert all(0 <= row["ai_ratio"] <= 100 for row in ai_rows.values())
        total_ai_replies = sum(row["ai_replies"] for row in ai_rows.values())
        total_student_messages = sum(
            row["student_messages"] for row in ai_rows.values()
        )
        global_ai_rate = round(
            total_ai_replies
            / (total_student_messages + total_ai_replies)
            * 100,
            1,
        )
        assert global_ai_rate == 33.3
        assert data["scaffold_usage"][0]["scaffold_name"] == "证据支架"
        assert data["ai_intervention_rate"][0]["student_name"] == "分析学生"
        assert any(
            row["name"] == ai_rows["analytics-student"]["student_name"]
            for row in data["discussion_depth"]
        )
        assert any(
            row["student_name"] == ai_rows["analytics-student"]["student_name"]
            for row in data["participation_heatmap"]
        )

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
class TestAssignmentTasks:
    """作业任务、自评和匿名互评 API"""

    async def test_task_peer_review_flow_with_missing_submitter(
        self,
        async_client: AsyncClient,
    ):
        teacher_token, _teacher = await _register_user(
            async_client,
            "teacher",
            "任务教师",
        )
        students = []
        for idx in range(7):
            token, user = await _register_user(
                async_client,
                "student",
                f"任务学生{idx}",
            )
            students.append((token, user))

        target_ids = [user["user_id"] for _token, user in students]
        create_resp = await async_client.post(
            "/teacher/assignment-tasks",
            json={
                "title": "互评测试作业",
                "description": "请提交测试作业",
                "target_student_ids": target_ids,
                "peer_review_count": 5,
            },
            headers=_auth(teacher_token),
        )
        assert create_resp.status_code == 200
        task_id = create_resp.json()["task_id"]
        assert create_resp.json()["target_count"] == 7

        list_resp = await async_client.get(
            "/assignments/tasks",
            headers=_auth(students[0][0]),
        )
        assert list_resp.status_code == 200
        assert any(item["task"]["task_id"] == task_id for item in list_resp.json())

        for idx, (token, _user) in enumerate(students[:6]):
            submit_resp = await async_client.post(
                f"/assignments/tasks/{task_id}/submit",
                json={"content": f"第 {idx} 份作业", "file_url": None},
                headers=_auth(token),
            )
            assert submit_resp.status_code == 200

        self_resp = await async_client.post(
            f"/assignments/tasks/{task_id}/self-review",
            json={"score": 88, "comment": "我完成得比较充分"},
            headers=_auth(students[0][0]),
        )
        assert self_resp.status_code == 200
        assert self_resp.json()["self_review"]["score"] == 88

        start_resp = await async_client.post(
            f"/teacher/assignment-tasks/{task_id}/start-peer-review",
            headers=_auth(teacher_token),
        )
        assert start_resp.status_code == 200
        assert start_resp.json()["status"] == "peer_review"
        assert start_resp.json()["peer_review_total"] == 35

        late_submit_resp = await async_client.post(
            f"/assignments/tasks/{task_id}/submit",
            json={"content": "迟交内容", "file_url": None},
            headers=_auth(students[6][0]),
        )
        assert late_submit_resp.status_code == 400

        missing_detail_resp = await async_client.get(
            f"/assignments/tasks/{task_id}",
            headers=_auth(students[6][0]),
        )
        assert missing_detail_resp.status_code == 200
        missing_detail = missing_detail_resp.json()
        assert missing_detail["assignment"] is None
        assert len(missing_detail["peer_reviews"]) == 5
        assert "reviewee_id" not in missing_detail["peer_reviews"][0]
        assert "reviewer_id" not in missing_detail["peer_reviews"][0]

        reviewer_detail_resp = await async_client.get(
            f"/assignments/tasks/{task_id}",
            headers=_auth(students[0][0]),
        )
        review_id = reviewer_detail_resp.json()["peer_reviews"][0]["id"]
        peer_submit_resp = await async_client.patch(
            f"/assignments/peer-reviews/{review_id}",
            json={"score": 92, "comment": "论证清楚"},
            headers=_auth(students[0][0]),
        )
        assert peer_submit_resp.status_code == 200
        assert peer_submit_resp.json()["status"] == "submitted"

        teacher_detail_resp = await async_client.get(
            f"/teacher/assignment-tasks/{task_id}",
            headers=_auth(teacher_token),
        )
        assert teacher_detail_resp.status_code == 200
        teacher_detail = teacher_detail_resp.json()
        assert teacher_detail["task"]["peer_review_completed"] == 1
        all_received = [
            review
            for target in teacher_detail["targets"]
            for review in target["peer_reviews_received"]
        ]
        assert any(review["reviewer_name"] == "任务学生0" for review in all_received)


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
