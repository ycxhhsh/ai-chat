"""WebSocket 事件分发器。

替代原项目 473 行的单函数 handler，改为注册-分发模式。
"""
from __future__ import annotations

import json
import logging

from fastapi import WebSocket

from app.schemas.websocket import WSEvent
from app.websockets.manager import ConnectionManager
from app.websockets.handlers.chat import handle_chat_send
from app.websockets.handlers.scaffold import handle_scaffold_set_active
from app.websockets.handlers.mindmap import (
    handle_mindmap_generate,
    handle_mindmap_edit,
    handle_mindmap_accept_draft,
)

logger = logging.getLogger(__name__)

# 事件 → 处理函数的注册表
_HANDLERS = {
    "CHAT_SEND": handle_chat_send,
    "SCAFFOLD_SET_ACTIVE": handle_scaffold_set_active,
    "MINDMAP_GENERATE": handle_mindmap_generate,
    "MINDMAP_EDIT": handle_mindmap_edit,
    "MINDMAP_ACCEPT_DRAFT": handle_mindmap_accept_draft,
}


async def dispatch(
    websocket: WebSocket,
    session_id: str,
    raw_text: str,
    manager: ConnectionManager,
) -> None:
    """解析 WS 消息并分发到对应 handler。"""
    try:
        raw = json.loads(raw_text)
        event = WSEvent(**raw)
    except Exception as e:
        logger.warning("Invalid WS event: %s", e)
        await manager.send_error(websocket, f"Invalid event format: {e}")
        return

    handler = _HANDLERS.get(event.event)
    if handler is None:
        logger.warning("Unknown event: %s", event.event)
        await manager.send_error(
            websocket, f"Unknown event: {event.event}", code="UNKNOWN_EVENT"
        )
        return

    try:
        await handler(websocket, session_id, event.data, manager)
    except Exception as e:
        logger.exception("Handler error for %s: %s", event.event, e)
        await manager.send_error(
            websocket, f"Internal error: {e}", code="HANDLER_ERROR"
        )
