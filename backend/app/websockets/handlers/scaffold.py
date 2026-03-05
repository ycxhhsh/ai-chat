"""Scaffold WS 事件处理。"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

from app.websockets.manager import ConnectionManager

logger = logging.getLogger(__name__)


async def handle_scaffold_set_active(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理教师切换支架开关。"""
    user_info = manager.get_user_info(websocket)
    if not user_info or user_info["role"] != "teacher":
        await manager.send_error(websocket, "Teacher role required")
        return

    scaffold_id = data.get("scaffold_id")
    is_active = data.get("is_active")
    target_user_id = data.get("target_user_id")  # None = 全局

    if scaffold_id is None or is_active is None:
        await manager.send_error(websocket, "Missing scaffold_id or is_active")
        return

    # 写入数据库
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.scaffold import Scaffold, UserScaffoldState
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            if target_user_id:
                # 定向覆盖（兼容 SQLite，无需 pg_insert）
                existing = await db.execute(
                    select(UserScaffoldState).where(
                        UserScaffoldState.session_id == session_id,
                        UserScaffoldState.user_id == target_user_id,
                        UserScaffoldState.scaffold_id == scaffold_id,
                    )
                )
                state = existing.scalar_one_or_none()
                if state:
                    state.is_active = is_active
                else:
                    db.add(UserScaffoldState(
                        session_id=session_id,
                        user_id=target_user_id,
                        scaffold_id=scaffold_id,
                        is_active=is_active,
                    ))
            else:
                # 全局切换
                result = await db.execute(
                    select(Scaffold).where(
                        Scaffold.scaffold_id == scaffold_id
                    )
                )
                scaffold = result.scalar_one_or_none()
                if scaffold:
                    scaffold.is_active = is_active

            await db.commit()
    except Exception as e:
        logger.error("Scaffold DB update failed: %s", e)
        await manager.send_error(websocket, f"Database error: {e}")
        return

    # 广播状态变更
    broadcast_data = {
        "scaffold_id": str(scaffold_id),
        "is_active": is_active,
        "target_user_id": target_user_id,
        "changed_by": user_info["user_id"],
    }

    if target_user_id:
        # 只通知目标用户
        await manager.send_to_user(
            session_id, target_user_id,
            "SCAFFOLD_STATE_CHANGED", broadcast_data,
        )
        # 同时通知所有教师
        for ws in manager.get_session_connections(session_id):
            info = manager.get_user_info(ws)
            if info and info["role"] == "teacher":
                await manager.send_to_user(
                    session_id, info["user_id"],
                    "SCAFFOLD_STATE_CHANGED", broadcast_data,
                )
    else:
        await manager.broadcast(
            session_id, "SCAFFOLD_STATE_CHANGED", broadcast_data,
        )

    logger.info(
        "Scaffold %s set to %s (target=%s) by %s",
        scaffold_id, is_active, target_user_id, user_info["user_id"],
    )
