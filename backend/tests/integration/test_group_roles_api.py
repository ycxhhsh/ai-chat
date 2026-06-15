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
            "email": f"group-role-{role}-{suffix}@test.com",
            "password": "pass123",
            "name": name,
            "role": role,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    return data["access_token"], data["user"]


async def _create_group(
    client: AsyncClient,
    token: str,
    name: str = "角色测试小组",
) -> dict:
    resp = await client.post(
        "/groups",
        json={"name": name},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    return resp.json()


@pytest.mark.asyncio
class TestStudentGroupRoles:
    async def test_group_creation_assigns_role_and_student_can_read_it(
        self,
        async_client: AsyncClient,
    ):
        token, _user = await _register_user(async_client, "student", "角色学生A")
        group = await _create_group(async_client, token)

        resp = await async_client.get(
            f"/groups/{group['id']}/role",
            headers=_auth(token),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] in {"推进者", "提问者", "解释者", "质疑者", "总结者"}
        assert data["description"]
        assert data["prompt"]
        assert data["action"]
        assert data["assigned_by"] == "system"
        assert data["pending_objection"] is None

    async def test_join_group_balances_new_member_role(
        self,
        async_client: AsyncClient,
    ):
        owner_token, _owner = await _register_user(
            async_client, "student", "角色组长"
        )
        joiner_token, _joiner = await _register_user(
            async_client, "student", "角色成员"
        )
        group = await _create_group(async_client, owner_token)

        owner_role_resp = await async_client.get(
            f"/groups/{group['id']}/role",
            headers=_auth(owner_token),
        )
        join_resp = await async_client.post(
            "/groups/join",
            json={"invite_code": group["invite_code"]},
            headers=_auth(joiner_token),
        )
        assert join_resp.status_code == 200

        joiner_role_resp = await async_client.get(
            f"/groups/{group['id']}/role",
            headers=_auth(joiner_token),
        )

        assert joiner_role_resp.status_code == 200
        assert joiner_role_resp.json()["role"] != owner_role_resp.json()["role"]

    async def test_student_can_submit_one_pending_role_objection(
        self,
        async_client: AsyncClient,
    ):
        token, _user = await _register_user(async_client, "student", "异议学生")
        group = await _create_group(async_client, token)

        resp = await async_client.post(
            f"/groups/{group['id']}/role-objections",
            json={"reason": "我不理解这个角色要做什么", "note": "需要老师解释一下"},
            headers=_auth(token),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pending"
        assert data["reason"] == "我不理解这个角色要做什么"

        duplicate_resp = await async_client.post(
            f"/groups/{group['id']}/role-objections",
            json={"reason": "我觉得这个角色不适合我", "note": None},
            headers=_auth(token),
        )
        assert duplicate_resp.status_code == 409

    async def test_new_role_assignment_avoids_roles_from_previous_objections(
        self,
        async_client: AsyncClient,
    ):
        teacher_token, _teacher = await _register_user(
            async_client, "teacher", "异议反哺教师"
        )
        student_token, student = await _register_user(
            async_client, "student", "异议反哺学生"
        )
        first_group = await _create_group(async_client, student_token, "第一次分组")

        update_resp = await async_client.patch(
            f"/teacher/groups/{first_group['id']}/members/{student['user_id']}/collaboration-role",
            json={"collaboration_role": "推进者"},
            headers=_auth(teacher_token),
        )
        assert update_resp.status_code == 200

        objection_resp = await async_client.post(
            f"/groups/{first_group['id']}/role-objections",
            json={"reason": "我觉得这个角色不适合我", "note": "先避开推进者"},
            headers=_auth(student_token),
        )
        assert objection_resp.status_code == 200

        second_group = await _create_group(async_client, student_token, "第二次分组")
        role_resp = await async_client.get(
            f"/groups/{second_group['id']}/role",
            headers=_auth(student_token),
        )

        assert role_resp.status_code == 200
        assert role_resp.json()["role"] != "推进者"


@pytest.mark.asyncio
class TestTeacherGroupRoles:
    async def test_teacher_group_list_includes_collaboration_roles(
        self,
        async_client: AsyncClient,
    ):
        teacher_token, _teacher = await _register_user(
            async_client, "teacher", "角色教师"
        )
        student_token, student = await _register_user(
            async_client, "student", "教师查看学生"
        )
        group = await _create_group(async_client, student_token)

        resp = await async_client.get(
            "/teacher/groups",
            headers=_auth(teacher_token),
        )

        assert resp.status_code == 200
        listed_group = next(item for item in resp.json() if item["id"] == group["id"])
        listed_member = next(
            member
            for member in listed_group["members"]
            if member["user_id"] == student["user_id"]
        )
        assert listed_member["collaboration_role"] in {
            "推进者",
            "提问者",
            "解释者",
            "质疑者",
            "总结者",
        }
        assert listed_member["role_assigned_by"] == "system"
        assert listed_member["pending_role_objection"] is None
        assert listed_member["role_action"]["observed"] is False

    async def test_teacher_group_list_shows_observed_role_action(
        self,
        async_client: AsyncClient,
        db_session,
    ):
        teacher_token, _teacher = await _register_user(
            async_client, "teacher", "角色观察教师"
        )
        student_token, student = await _register_user(
            async_client, "student", "角色观察学生"
        )
        group = await _create_group(async_client, student_token)
        update_resp = await async_client.patch(
            f"/teacher/groups/{group['id']}/members/{student['user_id']}/collaboration-role",
            json={"collaboration_role": "提问者"},
            headers=_auth(teacher_token),
        )
        assert update_resp.status_code == 200

        now = datetime.now(timezone.utc)
        db_session.add(
            Message(
                message_id=f"role-action-{uuid.uuid4()}",
                session_id=group["id"],
                sender={
                    "id": student["user_id"],
                    "name": student["name"],
                    "role": "student",
                },
                content="为什么这个空间布局能帮助小组协作？",
                timing={"absolute_time": now.isoformat(), "relative_minute": 0},
                metadata_info={},
                created_at=now,
            )
        )
        await db_session.commit()

        resp = await async_client.get(
            "/teacher/groups",
            headers=_auth(teacher_token),
        )

        listed_group = next(item for item in resp.json() if item["id"] == group["id"])
        listed_member = next(
            member
            for member in listed_group["members"]
            if member["user_id"] == student["user_id"]
        )
        assert listed_member["role_action"]["observed"] is True
        assert listed_member["role_action"]["evidence_message_id"]
        assert "为什么" in listed_member["role_action"]["evidence_excerpt"]

    async def test_teacher_can_update_member_collaboration_role(
        self,
        async_client: AsyncClient,
    ):
        teacher_token, _teacher = await _register_user(
            async_client, "teacher", "改角色教师"
        )
        student_token, student = await _register_user(
            async_client, "student", "被改角色学生"
        )
        group = await _create_group(async_client, student_token)

        resp = await async_client.patch(
            f"/teacher/groups/{group['id']}/members/{student['user_id']}/collaboration-role",
            json={"collaboration_role": "总结者"},
            headers=_auth(teacher_token),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["collaboration_role"] == "总结者"
        assert data["role_assigned_by"] == "teacher"

    async def test_teacher_can_resolve_role_objection(
        self,
        async_client: AsyncClient,
    ):
        teacher_token, _teacher = await _register_user(
            async_client, "teacher", "处理异议教师"
        )
        student_token, student = await _register_user(
            async_client, "student", "提出异议学生"
        )
        group = await _create_group(async_client, student_token)
        objection_resp = await async_client.post(
            f"/groups/{group['id']}/role-objections",
            json={"reason": "我觉得这个角色不适合我", "note": "想换成提问者"},
            headers=_auth(student_token),
        )
        objection_id = objection_resp.json()["id"]

        resp = await async_client.post(
            f"/teacher/group-role-objections/{objection_id}/resolve",
            json={
                "status": "resolved",
                "collaboration_role": "提问者",
                "resolution_note": "已调整为提问者",
            },
            headers=_auth(teacher_token),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "resolved"
        assert data["resolved_by"]

        role_resp = await async_client.get(
            f"/groups/{group['id']}/role",
            headers=_auth(student_token),
        )
        assert role_resp.json()["role"] == "提问者"
        assert role_resp.json()["assigned_by"] == "teacher"
        assert role_resp.json()["pending_objection"] is None
