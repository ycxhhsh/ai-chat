from __future__ import annotations

import json

import pytest
from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class _FakeLlmClient:
    calls: list[list[dict[str, str]]] = []

    async def chat(self, messages, temperature=0.0):  # noqa: ANN001, ANN201
        self.calls.append(messages)
        system_prompt = messages[0]["content"]
        if "suggested_next_step" in system_prompt:
            return json.dumps(
                {
                    "allowed": True,
                    "reason": "学生已经完成了关键追问，可以进入整合。",
                    "suggested_next_step": "integrate",
                },
                ensure_ascii=False,
            )
        if "摘要" in system_prompt:
            return "这是学习空间设计过程摘要。"
        return "这是 AI 的结构化回应。"


class _BackwardAccelerationClient:
    async def chat(self, messages, temperature=0.0):  # noqa: ANN001, ANN201
        return json.dumps(
            {
                "allowed": True,
                "reason": "模型错误地建议倒退。",
                "suggested_next_step": "self_think",
            },
            ensure_ascii=False,
        )


@pytest.mark.asyncio
class TestLearningSpaceDesign:
    async def test_teacher_student_flow(
        self,
        async_client: AsyncClient,
        teacher_token: str,
        student_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        from app.services import learning_space_design_service
        from app.services import learning_space_design_summary

        _FakeLlmClient.calls.clear()
        monkeypatch.setattr(
            learning_space_design_service,
            "get_llm_client",
            lambda _provider: _FakeLlmClient(),
        )
        monkeypatch.setattr(
            learning_space_design_summary,
            "get_llm_client",
            lambda _provider: _FakeLlmClient(),
        )

        create_resp = await async_client.post(
            "/learning-space-design/questions",
            json={
                "stage_name": "入项与启动",
                "title": "测试子问题",
                "description": "围绕项目主题开展结构化学习。",
                "enabled_steps": [
                    "self_think",
                    "ai_question",
                    "verify",
                    "challenge",
                    "integrate",
                ],
                "ai_round_limit": 3,
                "min_words_step1": 2,
                "min_words_step3": 2,
                "min_words_step5": 2,
                "allow_ai_acceleration": True,
            },
            headers=_auth(teacher_token),
        )
        assert create_resp.status_code == 200
        question_id = create_resp.json()["id"]

        student_questions_resp = await async_client.get(
            "/learning-space-design/student/questions",
            headers=_auth(student_token),
        )
        assert student_questions_resp.status_code == 200
        assert any(item["question"]["id"] == question_id for item in student_questions_resp.json())

        start_resp = await async_client.post(
            f"/learning-space-design/questions/{question_id}/start",
            json={"group_id": "group-test"},
            headers=_auth(student_token),
        )
        assert start_resp.status_code == 200
        session_id = start_resp.json()["id"]
        assert start_resp.json()["current_step"] == "self_think"

        create_entry_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/entries",
            json={"step_key": "self_think", "content": "我的初步方案"},
            headers=_auth(student_token),
        )
        assert create_entry_resp.status_code == 200
        self_think_entry_id = create_entry_resp.json()["entry"]

        update_entry_resp = await async_client.put(
            f"/learning-space-design/sessions/{session_id}/entries/{self_think_entry_id}",
            json={"content": "我的初步方案已经补充了新的证据"},
            headers=_auth(student_token),
        )
        assert update_entry_resp.status_code == 200

        submit_self_think_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/submit-step",
            json={"step_key": "self_think"},
            headers=_auth(student_token),
        )
        assert submit_self_think_resp.status_code == 200
        assert submit_self_think_resp.json()["current_step"] == "ai_question"

        ai_question_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/ai-message",
            json={
                "step_key": "ai_question",
                "content": "请帮我指出方案中的漏洞。",
                "llm_provider": "deepseek",
            },
            headers=_auth(student_token),
        )
        assert ai_question_resp.status_code == 200
        assert ai_question_resp.json()["ai_message"]["role"] == "assistant"

        submit_ai_question_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/submit-step",
            json={"step_key": "ai_question"},
            headers=_auth(student_token),
        )
        assert submit_ai_question_resp.status_code == 200
        assert submit_ai_question_resp.json()["current_step"] == "verify"

        verify_entry_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/entries",
            json={"step_key": "verify", "content": "我查找了资料并进行了交叉验证。"},
            headers=_auth(student_token),
        )
        assert verify_entry_resp.status_code == 200
        verify_entry_id = verify_entry_resp.json()["entry"]

        verify_update_resp = await async_client.put(
            f"/learning-space-design/sessions/{session_id}/entries/{verify_entry_id}",
            json={"content": "我查找了资料并进行了交叉验证，还比较了两种来源。"},
            headers=_auth(student_token),
        )
        assert verify_update_resp.status_code == 200

        submit_verify_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/submit-step",
            json={"step_key": "verify"},
            headers=_auth(student_token),
        )
        assert submit_verify_resp.status_code == 200
        assert submit_verify_resp.json()["current_step"] == "challenge"

        challenge_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/ai-message",
            json={
                "step_key": "challenge",
                "content": "请从反方角度继续质疑我的结论。",
                "llm_provider": "deepseek",
            },
            headers=_auth(student_token),
        )
        assert challenge_resp.status_code == 200
        assert challenge_resp.json()["user_message"]["round_index"] == 1
        assert any("已完成文本记录" in call[1]["content"] for call in _FakeLlmClient.calls)
        assert any("跨阶段对话线索" in call[1]["content"] for call in _FakeLlmClient.calls)

        check_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/check-acceleration",
            json={
                "step_key": "challenge",
                "content": "我已经能回应主要反驳点，并知道该如何整合修订。",
                "llm_provider": "deepseek",
            },
            headers=_auth(student_token),
        )
        assert check_resp.status_code == 200
        check_id = check_resp.json()["check"]

        adopt_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/adopt-acceleration",
            json={"check_id": check_id},
            headers=_auth(student_token),
        )
        assert adopt_resp.status_code == 200
        assert adopt_resp.json()["used_acceleration"] is True
        assert adopt_resp.json()["current_step"] == "integrate"

        integrate_entry_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/entries",
            json={"step_key": "integrate", "content": "我整合了证据，修订了方案并形成最终结论。"},
            headers=_auth(student_token),
        )
        assert integrate_entry_resp.status_code == 200

        early_summary_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/generate-summary",
            json={"llm_provider": "deepseek"},
            headers=_auth(student_token),
        )
        assert early_summary_resp.status_code == 400

        complete_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/submit-step",
            json={"step_key": "integrate"},
            headers=_auth(student_token),
        )
        assert complete_resp.status_code == 200
        assert complete_resp.json()["status"] == "completed"

        summary_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/generate-summary",
            json={"llm_provider": "deepseek"},
            headers=_auth(student_token),
        )
        assert summary_resp.status_code == 200
        assert summary_resp.json()["summary"] == "这是学习空间设计过程摘要。"

        payload_resp = await async_client.get(
            f"/learning-space-design/sessions/{session_id}",
            headers=_auth(student_token),
        )
        assert payload_resp.status_code == 200
        payload = payload_resp.json()
        assert len(payload["messages"]) == 4
        assert len(payload["revisions"]) == 2
        assert len(payload["acceleration_checks"]) == 1

        student_report_resp = await async_client.get(
            f"/learning-space-design/sessions/{session_id}/report",
            headers=_auth(student_token),
        )
        assert student_report_resp.status_code == 200
        student_report = student_report_resp.json()
        assert student_report["summary"] == "这是学习空间设计过程摘要。"
        assert student_report["basic_info"]["used_acceleration"] is True
        assert student_report["step_completion"][0]["word_count"] > 0
        assert all("revisions" not in step for step in student_report["steps"] if step["type"] == "text")

        student_export_resp = await async_client.get(
            f"/learning-space-design/sessions/{session_id}/export?viewer=teacher",
            headers=_auth(student_token),
        )
        assert student_export_resp.status_code == 200
        student_export = student_export_resp.json()
        assert all("revisions" not in step for step in student_export["steps"] if step["type"] == "text")

        teacher_report_resp = await async_client.get(
            f"/learning-space-design/sessions/{session_id}/report",
            headers=_auth(teacher_token),
        )
        assert teacher_report_resp.status_code == 200
        teacher_report = teacher_report_resp.json()
        assert any(step.get("revisions") for step in teacher_report["steps"] if step["type"] == "text")
        assert len(teacher_report["acceleration_checks"]) == 1

        other_register = await async_client.post(
            "/auth/register",
            json={
                "email": "other-learning-space@test.com",
                "password": "pass123",
                "name": "其他学生",
                "role": "student",
            },
        )
        other_token = other_register.json()["access_token"]
        forbidden_resp = await async_client.get(
            f"/learning-space-design/sessions/{session_id}",
            headers=_auth(other_token),
        )
        assert forbidden_resp.status_code == 403

        progress_resp = await async_client.get(
            "/learning-space-design/progress",
            headers=_auth(teacher_token),
        )
        assert progress_resp.status_code == 200
        assert progress_resp.json()[0]["status"] == "completed"

        delete_resp = await async_client.delete(
            f"/learning-space-design/questions/{question_id}",
            headers=_auth(teacher_token),
        )
        assert delete_resp.status_code == 409

    async def test_backward_acceleration_is_rejected(
        self,
        async_client: AsyncClient,
        teacher_token: str,
        student_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        from app.services import learning_space_design_service

        monkeypatch.setattr(
            learning_space_design_service,
            "get_llm_client",
            lambda _provider: _BackwardAccelerationClient(),
        )
        create_resp = await async_client.post(
            "/learning-space-design/questions",
            json={
                "stage_name": "入项与启动",
                "title": "倒退加速测试",
                "description": "验证加速不能倒退。",
                "enabled_steps": ["self_think", "verify", "integrate"],
                "ai_round_limit": 3,
                "min_words_step1": 2,
                "min_words_step3": 2,
                "min_words_step5": 2,
                "allow_ai_acceleration": True,
            },
            headers=_auth(teacher_token),
        )
        question_id = create_resp.json()["id"]
        start_resp = await async_client.post(
            f"/learning-space-design/questions/{question_id}/start",
            json={},
            headers=_auth(student_token),
        )
        session_id = start_resp.json()["id"]
        check_resp = await async_client.post(
            f"/learning-space-design/sessions/{session_id}/check-acceleration",
            json={
                "step_key": "self_think",
                "content": "我已经写出初步观点并准备验证。",
                "llm_provider": "deepseek",
            },
            headers=_auth(student_token),
        )
        assert check_resp.status_code == 200
        payload_resp = await async_client.get(
            f"/learning-space-design/sessions/{session_id}",
            headers=_auth(student_token),
        )
        check = payload_resp.json()["acceleration_checks"][0]
        assert check["allowed"] is False
        assert check["suggested_next_step"] is None
