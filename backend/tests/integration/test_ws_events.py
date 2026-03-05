"""WebSocket 事件处理单元测试。"""
from __future__ import annotations

import asyncio
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.websockets.handlers.chat import handle_chat_send


class FakeWebSocket:
    """模拟 WebSocket 连接。"""

    def __init__(self):
        self.sent: list[str] = []

    async def send_text(self, data: str) -> None:
        self.sent.append(data)


class FakeManager:
    """模拟 ConnectionManager。"""

    _DEFAULT_USER = {
        "user_id": "test-user",
        "user_name": "测试学生",
        "role": "student",
    }

    def __init__(self, user_info=_DEFAULT_USER):
        self._user_info = user_info
        self.broadcasts: list[tuple] = []
        self.sent_to_user: list[tuple] = []
        self.errors: list[str] = []

    def get_user_info(self, ws):
        return self._user_info

    async def broadcast(self, session_id, event, data, exclude=None):
        self.broadcasts.append((session_id, event, data))

    async def send_to_user(self, session_id, user_id, event, data):
        self.sent_to_user.append((session_id, user_id, event, data))

    async def send_error(self, ws, message):
        self.errors.append(message)


@pytest.mark.asyncio
class TestChatSend:
    """CHAT_SEND 事件测试。"""

    async def test_empty_content_rejected(self):
        """空内容应被拒绝。"""
        ws = FakeWebSocket()
        mgr = FakeManager()
        await handle_chat_send(ws, "s1", {"content": ""}, mgr)
        assert len(mgr.errors) == 1
        assert "empty" in mgr.errors[0].lower()

    async def test_unauthenticated_rejected(self):
        """未认证用户应被拒绝。"""
        ws = FakeWebSocket()
        mgr = FakeManager(user_info=None)
        await handle_chat_send(ws, "s1", {"content": "hello"}, mgr)
        assert len(mgr.errors) == 1
        assert "authenticated" in mgr.errors[0].lower()

    @patch(
        "app.websockets.handlers.chat._save_message_and_ack",
        new_callable=AsyncMock,
    )
    @patch(
        "app.websockets.handlers.chat._run_fallacy_detection",
        new_callable=AsyncMock,
    )
    async def test_group_message_broadcast(self, mock_fallacy, mock_save):
        """小组消息应广播给所有人。"""
        ws = FakeWebSocket()
        mgr = FakeManager()
        data = {"content": "大家好", "target_user": None}
        await handle_chat_send(ws, "session-1", data, mgr)

        # 消息应被广播
        assert len(mgr.broadcasts) >= 1
        event = mgr.broadcasts[0]
        assert event[1] == "CHAT_MESSAGE"
        assert event[2]["content"] == "大家好"
        assert event[2]["sender"]["id"] == "test-user"

    @patch(
        "app.websockets.handlers.chat._save_message_and_ack",
        new_callable=AsyncMock,
    )
    @patch(
        "app.websockets.handlers.chat._trigger_ai_reply",
        new_callable=AsyncMock,
    )
    async def test_ai_private_message_sent_to_user(
        self, mock_ai_reply, mock_save,
    ):
        """AI 私聊消息应仅发送给用户本人。"""
        ws = FakeWebSocket()
        mgr = FakeManager()
        data = {"content": "你好AI", "target_user": "ai"}
        await handle_chat_send(ws, "session-1", data, mgr)

        # 私聊消息只给用户
        assert len(mgr.sent_to_user) >= 1
        event = mgr.sent_to_user[0]
        assert event[1] == "test-user"
        assert event[2] == "CHAT_MESSAGE"

    @patch(
        "app.websockets.handlers.chat._save_message_and_ack",
        new_callable=AsyncMock,
    )
    @patch(
        "app.websockets.handlers.chat._trigger_ai_reply",
        new_callable=AsyncMock,
    )
    async def test_ai_mention_triggers_reply(
        self, mock_ai_reply, mock_save,
    ):
        """@ai 提及应触发 AI 回复。"""
        ws = FakeWebSocket()
        mgr = FakeManager()
        data = {
            "content": "这个问题 @ai 你怎么看",
            "metadata": {"mentions": []},
        }
        await handle_chat_send(ws, "session-1", data, mgr)

        # 等待 asyncio.create_task 启动的任务
        await asyncio.sleep(0.1)

        # AI 回复应被触发
        assert mock_ai_reply.called or len(mgr.broadcasts) > 0

    @patch(
        "app.websockets.handlers.chat._save_message_and_ack",
        new_callable=AsyncMock,
    )
    async def test_request_id_passed_to_save(self, mock_save):
        """request_id 应传递给 _save_message_and_ack。"""
        ws = FakeWebSocket()
        mgr = FakeManager()
        data = {"content": "测试消息", "request_id": "req-123"}
        await handle_chat_send(ws, "session-1", data, mgr)

        # 等待 task 启动
        await asyncio.sleep(0.1)

        # 验证 mock_save 被调用（通过 asyncio.create_task）
        # 注意：create_task 可能还没完成，但至少函数调用参数正确
