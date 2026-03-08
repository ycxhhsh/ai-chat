"""WebSocket 路由入口 — 含心跳保活机制。"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.security import decode_access_token
from app.websockets.dispatcher import dispatch
from app.websockets.manager import manager

logger = logging.getLogger(__name__)

router = APIRouter()

# 心跳间隔（秒）
_HEARTBEAT_INTERVAL = 25
# Pong 超时（秒）
_PONG_TIMEOUT = 10


async def _heartbeat(websocket: WebSocket) -> None:
    """定期向客户端发送 ping，保持连接活跃。

    WebSocket 协议原生 ping/pong 可穿透大部分代理/负载均衡的超时。
    若代理不透传 ping，改用应用层 JSON 心跳。
    """
    try:
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL)
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            try:
                # 优先发应用层心跳（确保穿透 Nginx 等反向代理）
                await websocket.send_text('{"event":"PING","data":{}}')
            except Exception:
                break
    except asyncio.CancelledError:
        pass


async def _load_session_data(
    session_id: str, user_id: str = "", after_cursor: str = "",
) -> dict:
    """加载 SESSION_JOINED 所需的支架列表和历史消息。

    user_id 用于过滤：只返回小组消息 + 当前用户的私聊 AI 消息。
    after_cursor: ISO 时间戳游标，若提供则只返回此时间之后的消息（增量）。
    """
    scaffolds_data = []
    recent_messages = []

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.scaffold import Scaffold
        from app.models.message import Message
        from app.models.ai_conversation import AiConversation
        from sqlalchemy import select, or_, and_

        async with AsyncSessionLocal() as db:
            # 加载活跃支架
            result = await db.execute(
                select(Scaffold)
                .where(Scaffold.is_active == True)  # noqa: E712
                .order_by(Scaffold.sort_order)
            )
            scaffolds = result.scalars().all()
            scaffolds_data = [
                {
                    "scaffold_id": str(s.scaffold_id),
                    "display_name": s.display_name,
                    "prompt_template": s.prompt_template,
                    "is_active": s.is_active,
                    "sort_order": s.sort_order,
                }
                for s in scaffolds
            ]

            # 加载消息（仅小组消息 + 当前用户的 AI 私聊）
            query = (
                select(Message)
                .where(Message.session_id == session_id)
            )
            if user_id:
                query = query.where(
                    or_(
                        # 小组消息 (recipient_id is null)
                        Message.recipient_id.is_(None),
                        # AI 回复给当前用户的消息
                        Message.recipient_id == user_id,
                        # 用户发给 AI 的消息
                        and_(
                            Message.recipient_id == "ai",
                            Message.conversation_id.in_(
                                select(AiConversation.conversation_id).where(
                                    AiConversation.user_id == user_id
                                )
                            ),
                        ),
                    )
                )
            # 游标增量：只返回 cursor 时间之后的消息
            if after_cursor:
                from datetime import datetime
                try:
                    cursor_dt = datetime.fromisoformat(after_cursor)
                    query = query.where(Message.created_at > cursor_dt)
                except ValueError:
                    pass  # 无效游标，忽略
            result = await db.execute(
                query.order_by(Message.created_at.desc()).limit(50)
            )
            msgs = result.scalars().all()
            # 反转为时间正序
            msgs = list(reversed(msgs))
            recent_messages = [
                {
                    "message_id": m.message_id,
                    "session_id": m.session_id,
                    "sender": m.sender if isinstance(m.sender, dict) else {},
                    "content": m.content,
                    "timing": m.timing if isinstance(m.timing, dict) else {},
                    "metadata_info": (
                        m.metadata_info
                        if isinstance(m.metadata_info, dict)
                        else {}
                    ),
                    "created_at": (
                        m.created_at.isoformat()
                        if m.created_at
                        else None
                    ),
                    "recipient_id": m.recipient_id,
                }
                for m in msgs
            ]
    except Exception as e:
        logger.warning("Failed to load session data: %s", e)

    return {
        "scaffolds": scaffolds_data,
        "recent_messages": recent_messages,
    }


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    # 从 query 或 header 获取 token
    token = websocket.query_params.get("token", "")
    if not token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    payload = decode_access_token(token) if token else None
    if not payload:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    user_id = payload.get("sub", "")
    user_name = payload.get("name", "User")
    role = payload.get("role", "student")

    await manager.connect(
        websocket, session_id, user_id, user_name, role
    )

    # 解析游标参数（重连增量加载）
    cursor = websocket.query_params.get("cursor", "")

    # 加载 session 数据（支架 + 历史消息）
    session_data = await _load_session_data(
        session_id, user_id=user_id, after_cursor=cursor,
    )

    # 发送 SESSION_JOINED 事件
    from app.llm.factory import get_available_providers
    await websocket.send_text(
        json.dumps({
            "event": "SESSION_JOINED",
            "data": {
                "session_id": session_id,
                "user_id": user_id,
                "online_users": manager.get_online_user_ids(session_id),
                "available_providers": get_available_providers(),
                "scaffolds": session_data["scaffolds"],
                "recent_messages": session_data["recent_messages"],
            },
        })
    )

    # 广播有人加入
    await manager.broadcast(
        session_id,
        "USER_JOINED",
        {"user_id": user_id, "user_name": user_name, "role": role},
        exclude=websocket,
    )

    # 启动心跳协程
    heartbeat_task = asyncio.create_task(_heartbeat(websocket))

    try:
        while True:
            text = await websocket.receive_text()
            # 忽略客户端 PONG 回复
            if text.strip() in ('{"event":"PONG","data":{}}', '{"event":"PONG"}'):
                continue
            await dispatch(websocket, session_id, text, manager)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("WS error for user=%s: %s", user_id, e)
    finally:
        heartbeat_task.cancel()
        manager.disconnect(websocket)
        # 安全广播离开事件
        try:
            await manager.broadcast(
                session_id,
                "SESSION_LEFT",
                {"user_id": user_id},
            )
        except Exception:
            pass
