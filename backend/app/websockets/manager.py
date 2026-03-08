"""WebSocket 连接管理器。

支持两种广播模式：
- 单 worker（无 Redis）：纯本地广播
- 多 worker（有 Redis）：本地广播 + Redis pubsub 跨进程同步
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """管理多会话多用户的 WebSocket 连接。"""

    # Redis pubsub channel 前缀
    CHANNEL_PREFIX = "cothink:ws:"

    def __init__(self) -> None:
        # session_id -> list[WebSocket]
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)
        # websocket -> {user_id, user_name, role, session_id}
        self._user_info: dict[WebSocket, dict] = {}
        # Redis pubsub 监听任务
        self._pubsub_tasks: dict[str, asyncio.Task] = {}
        # 后台任务注册表（生命周期管理）
        self._background_tasks: set[asyncio.Task] = set()

    def _track_task(self, coro) -> asyncio.Task:
        """创建并追踪后台任务，完成后自动移除。"""
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    async def shutdown(self) -> None:
        """优雅关闭所有后台任务。"""
        for task in list(self._background_tasks):
            task.cancel()
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)
        for task in list(self._pubsub_tasks.values()):
            task.cancel()

    async def connect(
        self,
        websocket: WebSocket,
        session_id: str,
        user_id: str,
        user_name: str,
        role: str,
    ) -> None:
        await websocket.accept()
        self._connections[session_id].append(websocket)
        self._user_info[websocket] = {
            "user_id": user_id,
            "user_name": user_name,
            "role": role,
            "session_id": session_id,
        }
        logger.info("WS connected: user=%s session=%s", user_id, session_id)

        # 如果是该 session 的第一个连接，启动 Redis 监听
        if len(self._connections[session_id]) == 1:
            await self._start_redis_listener(session_id)

    def disconnect(self, websocket: WebSocket) -> None:
        info = self._user_info.pop(websocket, None)
        if info:
            session_id = info["session_id"]
            conns = self._connections.get(session_id, [])
            if websocket in conns:
                conns.remove(websocket)
            if not conns:
                self._connections.pop(session_id, None)
                # 无人连接时取消 Redis 监听
                self._stop_redis_listener(session_id)
            logger.info(
                "WS disconnected: user=%s session=%s",
                info["user_id"],
                session_id,
            )

    def get_user_info(self, websocket: WebSocket) -> dict | None:
        return self._user_info.get(websocket)

    def get_session_connections(self, session_id: str) -> list[WebSocket]:
        return self._connections.get(session_id, [])

    def get_online_user_ids(self, session_id: str) -> list[str]:
        return [
            self._user_info[ws]["user_id"]
            for ws in self._connections.get(session_id, [])
            if ws in self._user_info
        ]

    def get_total_connections(self) -> int:
        """获取所有活跃连接数。"""
        return len(self._user_info)

    async def broadcast(
        self,
        session_id: str,
        event: str,
        data: dict,
        exclude: WebSocket | None = None,
        *,
        via_redis: bool = True,
    ) -> None:
        """向会话内所有连接广播事件。

        Args:
            session_id: 会话 ID
            event: 事件名
            data: 事件数据
            exclude: 排除的连接
            via_redis: 是否同时通过 Redis 广播（多 worker 同步）
        """
        message = json.dumps({"event": event, "data": data})

        # 1. 本地广播
        await self._broadcast_local(session_id, message, exclude)

        # 2. Redis 广播（如果可用且启用）
        if via_redis:
            from app.infra import redis_client
            if redis_client.is_available():
                channel = f"{self.CHANNEL_PREFIX}{session_id}"
                # 标记来源进程，防止同进程 listener 重复广播
                tagged = json.dumps(
                    {"event": event, "data": data, "_origin": id(self)}
                )
                await redis_client.publish(channel, tagged)

    async def _broadcast_local(
        self,
        session_id: str,
        message: str,
        exclude: WebSocket | None = None,
    ) -> None:
        """纯本地广播（不经过 Redis）。"""
        for ws in list(self._connections.get(session_id, [])):
            if ws is exclude:
                continue
            try:
                await ws.send_text(message)
            except Exception:
                logger.warning("Failed to send to WS, removing")
                self.disconnect(ws)

    async def send_to_user(
        self,
        session_id: str,
        user_id: str,
        event: str,
        data: dict,
    ) -> None:
        """向指定用户发送事件。"""
        message = json.dumps({"event": event, "data": data})
        for ws in list(self._connections.get(session_id, [])):
            info = self._user_info.get(ws)
            if info and info["user_id"] == user_id:
                try:
                    await ws.send_text(message)
                except Exception:
                    self.disconnect(ws)

    async def send_error(
        self, websocket: WebSocket, message: str, code: str = "ERROR"
    ) -> None:
        try:
            await websocket.send_text(
                json.dumps(
                    {"event": "ERROR", "data": {"message": message, "code": code}}
                )
            )
        except Exception:
            pass

    # ── Redis Pubsub 监听 ──

    async def _start_redis_listener(self, session_id: str) -> None:
        """启动 Redis pubsub 监听协程。"""
        from app.infra import redis_client

        if not redis_client.is_available():
            logger.warning("Redis not available, skipping pubsub for %s", session_id)
            return

        if session_id in self._pubsub_tasks:
            return

        channel = f"{self.CHANNEL_PREFIX}{session_id}"
        pubsub = await redis_client.subscribe(channel)
        if pubsub:
            task = self._track_task(
                self._redis_listener_loop(session_id, pubsub)
            )
            self._pubsub_tasks[session_id] = task
            logger.info("Redis pubsub listener STARTED for session=%s channel=%s", session_id, channel)
        else:
            logger.error("Failed to subscribe to Redis channel %s", channel)

    def _stop_redis_listener(self, session_id: str) -> None:
        """停止 Redis pubsub 监听协程。"""
        task = self._pubsub_tasks.pop(session_id, None)
        if task and not task.done():
            task.cancel()
            logger.info("Redis pubsub listener STOPPED for session %s", session_id)

    async def _redis_listener_loop(self, session_id: str, pubsub) -> None:
        """持续监听 Redis channel 并转发到本地连接。

        特殊处理 AI_REPLY_DONE：拦截后执行落库和后续任务，不转发给客户端。
        """
        try:
            async for raw_message in pubsub.listen():
                if raw_message["type"] != "message":
                    continue

                raw_data = raw_message["data"]

                # 尝试解析以拦截特殊事件
                try:
                    parsed = json.loads(raw_data)
                    event = parsed.get("event")

                    # 跳过本进程自己发出的广播（避免双重投递）
                    if parsed.get("_origin") == id(self):
                        continue

                    if event == "AI_REPLY_DONE":
                        # 拦截：由 FastAPI 进程处理落库和后续任务
                        self._track_task(
                            self._handle_ai_reply_done(parsed.get("data", {}))
                        )
                        continue  # 不转发给客户端
                except (json.JSONDecodeError, KeyError):
                    pass

                # 其他进程发出的事件：转发到本地所有连接
                # 去掉 _origin 标记后再转发
                try:
                    clean = json.loads(raw_data)
                    clean.pop("_origin", None)
                    raw_data = json.dumps(clean)
                except (json.JSONDecodeError, KeyError):
                    pass
                await self._broadcast_local(session_id, raw_data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Redis listener error for session %s: %s", session_id, e)
        finally:
            try:
                await pubsub.unsubscribe()
                await pubsub.close()
            except Exception:
                pass

    async def _handle_ai_reply_done(self, data: dict) -> None:
        """处理 Worker 完成的 AI 回复：落库 + 后续任务。"""
        import uuid as _uuid
        from datetime import datetime, timezone

        session_id = data.get("session_id", "")
        content = data.get("content", "")
        llm_provider = data.get("llm_provider", "")
        user_info = data.get("user_info", {})
        is_private = data.get("is_private", False)
        conversation_id = data.get("conversation_id")

        # 构造 AI 消息
        ai_msg_id = str(_uuid.uuid4())
        now = datetime.now(timezone.utc)
        ai_message = {
            "message_id": ai_msg_id,
            "session_id": session_id,
            "sender": {"id": "ai", "name": "AI 助教", "role": "ai"},
            "content": content,
            "timing": {
                "absolute_time": now.isoformat(),
                "relative_minute": 0,
            },
            "metadata_info": {"llm_provider": llm_provider},
            "created_at": now.isoformat(),
            "recipient_id": user_info.get("user_id") if is_private else None,
            "conversation_id": conversation_id,
        }

        # 广播完整 AI 消息给客户端
        if is_private:
            await self.send_to_user(
                session_id, user_info.get("user_id", ""),
                "CHAT_MESSAGE", ai_message,
            )
        else:
            await self.broadcast(
                session_id, "CHAT_MESSAGE", ai_message, via_redis=False,
            )

        # 异步落库
        asyncio.create_task(self._save_ai_message(ai_message))

        # 自动更新思维导图
        try:
            from app.websockets.handlers.mindmap import _generate_mindmap
            self._track_task(
                _generate_mindmap(session_id, user_info, self, auto_trigger=True)
            )
        except Exception as e:
            logger.warning("Auto mindmap trigger failed: %s", e)

        # 更新对话统计
        if conversation_id:
            self._track_task(
                self._update_conversation_after_reply(
                    conversation_id=conversation_id,
                    user_message=data.get("user_message", ""),
                    ai_response=content,
                    llm_provider=llm_provider,
                    session_id=session_id,
                    user_id=user_info.get("user_id", ""),
                )
            )

    async def _save_ai_message(self, message: dict) -> None:
        """保存 AI 回复到数据库。"""
        try:
            from app.db.session import AsyncSessionLocal
            from app.models.message import Message

            async with AsyncSessionLocal() as db:
                msg = Message(
                    message_id=message["message_id"],
                    session_id=message["session_id"],
                    sender=message["sender"],
                    content=message["content"],
                    timing=message["timing"],
                    metadata_info=message.get("metadata_info", {}),
                    recipient_id=message.get("recipient_id"),
                    conversation_id=message.get("conversation_id"),
                )
                db.add(msg)
                await db.commit()
        except Exception as e:
            logger.error("Failed to save AI message: %s", e)

    async def _update_conversation_after_reply(
        self,
        *,
        conversation_id: str,
        user_message: str,
        ai_response: str,
        llm_provider: str,
        session_id: str,
        user_id: str,
    ) -> None:
        """更新对话会话统计 + 首轮自动标题。"""
        try:
            from app.db.session import AsyncSessionLocal
            from app.models.ai_conversation import AiConversation
            from sqlalchemy import select, update as sql_update
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(AiConversation).where(
                        AiConversation.conversation_id == conversation_id
                    )
                )
                convo = result.scalar_one_or_none()
                if not convo:
                    return

                old_count = convo.message_count
                await db.execute(
                    sql_update(AiConversation)
                    .where(AiConversation.conversation_id == conversation_id)
                    .values(
                        message_count=old_count + 2,
                        updated_at=now,
                        llm_provider=llm_provider,
                    )
                )
                await db.commit()

            # 首轮：自动生成标题
            if old_count == 0:
                from app.websockets.handlers.chat import _generate_conversation_title
                title = await _generate_conversation_title(
                    user_message, ai_response, llm_provider
                )
                if title:
                    async with AsyncSessionLocal() as db:
                        await db.execute(
                            sql_update(AiConversation)
                            .where(
                                AiConversation.conversation_id == conversation_id
                            )
                            .values(title=title)
                        )
                        await db.commit()

                    await self.send_to_user(
                        session_id, user_id,
                        "AI_CONVERSATION_TITLE",
                        {"conversation_id": conversation_id, "title": title},
                    )
        except Exception as e:
            logger.warning("Failed to update conversation stats: %s", e)


# 全局单例
manager = ConnectionManager()
