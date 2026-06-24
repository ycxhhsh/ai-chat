"""Regression tests for durable AI reply delivery."""
from __future__ import annotations

from app.services.ai_reply_delivery import build_ai_message


def test_build_ai_message_uses_task_id_as_stable_message_id():
    message = build_ai_message(
        message_id="task-123",
        session_id="student-1",
        content="durable reply",
        llm_provider="deepseek",
        user_info={"user_id": "student-1"},
        is_private=True,
        conversation_id="conv-1",
    )

    assert message["message_id"] == "task-123"
    assert message["recipient_id"] == "student-1"
    assert message["conversation_id"] == "conv-1"
