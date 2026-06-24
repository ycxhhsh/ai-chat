"""Regression tests for reliable WebSocket reply delivery."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from redis.exceptions import TimeoutError as RedisTimeoutError

from app.infra import redis_client
from app.websockets.manager import ConnectionManager


@pytest.mark.asyncio
async def test_pubsub_subscription_disables_socket_read_timeout(monkeypatch):
    captured_kwargs: dict = {}

    class FakePubSub:
        async def subscribe(self, channel):
            return None

    class FakeRedis:
        def pubsub(self):
            return FakePubSub()

    def fake_from_url(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return FakeRedis()

    monkeypatch.setattr(redis_client, "_available", True)
    monkeypatch.setattr(redis_client.aioredis, "from_url", fake_from_url)

    await redis_client.subscribe("cothink:ws:student-1")

    assert captured_kwargs["socket_timeout"] is None


def _disable_follow_up_tasks(manager: ConnectionManager) -> None:
    def close_coroutine(coro):
        coro.close()
        return None

    manager._track_task = close_coroutine  # type: ignore[method-assign]


@pytest.mark.asyncio
async def test_persisted_reply_is_forwarded_without_second_insert(monkeypatch):
    manager = ConnectionManager()
    manager.send_to_user = AsyncMock()  # type: ignore[method-assign]
    _disable_follow_up_tasks(manager)
    persist = AsyncMock()
    manager._save_ai_message = persist  # type: ignore[method-assign]
    message = {
        "message_id": "task-123",
        "session_id": "student-1",
        "sender": {"id": "ai", "name": "AI ??", "role": "ai"},
        "content": "durable reply",
        "timing": {"absolute_time": "2026-06-24T00:00:00+00:00", "relative_minute": 0},
        "metadata_info": {"llm_provider": "deepseek"},
        "created_at": "2026-06-24T00:00:00+00:00",
        "recipient_id": "student-1",
        "conversation_id": None,
    }

    await manager._handle_ai_reply_done({
        "persisted": True,
        "message": message,
        "session_id": "student-1",
        "user_info": {"user_id": "student-1"},
        "is_private": True,
        "llm_provider": "deepseek",
    })

    persist.assert_not_awaited()
    manager.send_to_user.assert_awaited_once_with(
        "student-1", "student-1", "CHAT_MESSAGE", message,
    )


@pytest.mark.asyncio
async def test_legacy_reply_is_persisted_exactly_once(monkeypatch):
    manager = ConnectionManager()
    manager.send_to_user = AsyncMock()  # type: ignore[method-assign]
    _disable_follow_up_tasks(manager)
    persist = AsyncMock()
    manager._save_ai_message = persist  # type: ignore[method-assign]

    await manager._handle_ai_reply_done({
        "task_id": "legacy-task",
        "session_id": "student-1",
        "content": "legacy reply",
        "user_info": {"user_id": "student-1"},
        "is_private": True,
        "llm_provider": "deepseek",
        "conversation_id": None,
    })

    persist.assert_awaited_once()
    saved_message = persist.await_args.args[0]
    assert saved_message["message_id"] == "legacy-task"


@pytest.mark.asyncio
async def test_listener_resubscribes_and_requests_sync_after_timeout(monkeypatch):
    manager = ConnectionManager()
    manager._connections["student-1"].append(object())  # type: ignore[arg-type]
    sync_seen = asyncio.Event()

    class BrokenPubSub:
        async def listen(self):
            raise RedisTimeoutError("Timeout reading from redis:6379")
            yield None

        async def unsubscribe(self):
            return None

        async def close(self):
            return None

    class WaitingPubSub:
        async def listen(self):
            await asyncio.Event().wait()
            yield None

        async def unsubscribe(self):
            return None

        async def close(self):
            return None

    subscribe = AsyncMock(return_value=WaitingPubSub())
    monkeypatch.setattr(redis_client, "subscribe", subscribe)

    async def capture_local(session_id, raw_message, exclude=None):
        payload = json.loads(raw_message)
        if payload["event"] == "AI_SYNC_REQUIRED":
            assert payload["data"] == {"reason": "redis_listener_recovered"}
            sync_seen.set()

    manager._broadcast_local = capture_local  # type: ignore[method-assign]
    task = asyncio.create_task(
        manager._redis_listener_loop("student-1", BrokenPubSub())
    )

    await asyncio.wait_for(sync_seen.wait(), timeout=2)
    task.cancel()
    await task

    subscribe.assert_awaited_once_with("cothink:ws:student-1")
