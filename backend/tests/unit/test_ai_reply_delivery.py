"""Regression tests for durable AI reply delivery."""
from __future__ import annotations

import json

import pytest

from app.infra.ai_worker import execute_ai_task
from app.services import ai_reply_delivery
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


@pytest.mark.asyncio
async def test_worker_persists_before_publishing_done(monkeypatch):
    actions: list[str] = []
    published: list[dict] = []

    class FakeClient:
        async def stream_chat(self, *, messages):
            yield "durable reply"

    class FakeRedis:
        async def publish(self, channel, payload):
            event = json.loads(payload)
            actions.append(f"publish:{event['event']}")
            published.append(event)

        async def close(self):
            return None

    async def fake_persist(message):
        actions.append("persist")

    monkeypatch.setattr(
        "app.llm.factory.get_llm_client",
        lambda provider: FakeClient(),
    )
    monkeypatch.setattr(
        "redis.asyncio.from_url",
        lambda *args, **kwargs: FakeRedis(),
    )
    monkeypatch.setattr(
        ai_reply_delivery,
        "persist_ai_message",
        fake_persist,
    )

    await execute_ai_task({
        "task_id": "task-123",
        "session_id": "student-1",
        "llm_provider": "deepseek",
        "messages": [{"role": "user", "content": "hello"}],
        "user_info": {"user_id": "student-1"},
        "is_private": False,
        "conversation_id": "conv-1",
    })

    assert actions.index("persist") < actions.index("publish:AI_REPLY_DONE")
    done_payload = next(item for item in published if item["event"] == "AI_REPLY_DONE")
    assert done_payload["data"]["message"]["message_id"] == "task-123"
    assert done_payload["data"]["persisted"] is True
