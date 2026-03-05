"""MindMap WS 事件处理。"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from app.websockets.manager import ConnectionManager

logger = logging.getLogger(__name__)

# 防抖：每个 session 最近一次生成时间（秒级时间戳）
_last_generate_ts: dict[str, float] = {}
_DEBOUNCE_SECONDS = 30


async def handle_mindmap_generate(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理思维导图生成请求。"""
    user_info = manager.get_user_info(websocket)
    if not user_info:
        await manager.send_error(websocket, "Not authenticated")
        return

    # 通知前端生成中
    await manager.broadcast(
        session_id,
        "MINDMAP_GENERATING",
        {"is_generating": True, "triggered_by": user_info["user_id"]},
    )

    asyncio.create_task(
        _generate_mindmap(session_id, user_info, manager)
    )


async def _generate_mindmap(
    session_id: str,
    user_info: dict,
    manager: ConnectionManager,
    *,
    auto_trigger: bool = False,
) -> None:
    """从对话中提取思维导图。

    Args:
        auto_trigger: 若为 True，表示由 AI 回复自动触发，会做防抖检查。
    """
    # 防抖检查（仅自动触发时生效）
    if auto_trigger:
        now = time.time()
        last = _last_generate_ts.get(session_id, 0)
        if now - last < _DEBOUNCE_SECONDS:
            logger.info(
                "Mindmap debounce: skip session=%s (%.0fs since last)",
                session_id, now - last,
            )
            return
        _last_generate_ts[session_id] = now

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.message import Message
        from app.models.mindmap import MindMap
        from app.llm.factory import get_llm_client
        from app.llm.prompts import MINDMAP_EXTRACTION_PROMPT
        from sqlalchemy import select

        # 获取对话历史
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.created_at.desc())
                .limit(50)
            )
            messages = result.scalars().all()

        if not messages:
            if not auto_trigger:
                await manager.broadcast(
                    session_id,
                    "ERROR",
                    {"message": "没有足够的对话数据生成思维导图", "code": "NO_DATA"},
                )
                await manager.broadcast(
                    session_id,
                    "MINDMAP_GENERATING",
                    {"is_generating": False},
                )
            return

        # 查找已有思维导图（用于增量更新）
        existing_context = ""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MindMap)
                .where(MindMap.session_id == session_id)
                .order_by(MindMap.updated_at.desc())
                .limit(1)
            )
            existing_map = result.scalar_one_or_none()
            if existing_map and existing_map.nodes:
                existing_context = (
                    "\n\n以下是当前已有的思维导图数据，请在此基础上增量更新"
                    "（保留仍然相关的节点，添加新概念，移除不再相关的节点）：\n"
                    f"{json.dumps({'nodes': existing_map.nodes, 'edges': existing_map.edges}, ensure_ascii=False)}"
                )

        # 构建对话文本
        conversation_text = "\n".join(
            f"[{m.sender.get('name', '未知')}]: {m.content}"
            for m in reversed(messages)
        )

        # 调用 LLM 提取
        client = get_llm_client("deepseek")
        llm_messages = [
            {"role": "system", "content": MINDMAP_EXTRACTION_PROMPT},
            {"role": "user", "content": f"对话内容：\n{conversation_text}{existing_context}"},
        ]

        full_response = ""
        async for chunk in client.stream_chat(messages=llm_messages):
            full_response += chunk

        # 解析 JSON
        try:
            # 尝试提取 JSON 块
            if "```" in full_response:
                json_str = full_response.split("```")[1]
                if json_str.startswith("json"):
                    json_str = json_str[4:]
                mindmap_data = json.loads(json_str.strip())
            else:
                mindmap_data = json.loads(full_response.strip())
        except json.JSONDecodeError:
            logger.error("Failed to parse mindmap JSON: %s", full_response[:200])
            await manager.broadcast(
                session_id,
                "ERROR",
                {"message": "思维导图数据解析失败", "code": "PARSE_ERROR"},
            )
            await manager.broadcast(
                session_id,
                "MINDMAP_GENERATING",
                {"is_generating": False},
            )
            return

        nodes = mindmap_data.get("nodes", [])
        edges = mindmap_data.get("edges", [])

        # 为节点添加布局位置
        for i, node in enumerate(nodes):
            if "position" not in node:
                row = i // 4
                col = i % 4
                node["position"] = {"x": col * 200 + 50, "y": row * 150 + 50}

        # ── 铁律 2 草稿模式：不直接写入 DB，先作为草稿广播 ──
        draft_id = str(uuid.uuid4())
        await manager.broadcast(
            session_id,
            "MINDMAP_DRAFT",
            {
                "draft_id": draft_id,
                "session_id": session_id,
                "nodes": nodes,
                "edges": edges,
                "generated_by": user_info["user_id"],
            },
        )
        await manager.broadcast(
            session_id,
            "MINDMAP_GENERATING",
            {"is_generating": False},
        )

    except Exception as e:
        logger.exception("Mindmap generation failed: %s", e)
        await manager.broadcast(
            session_id,
            "ERROR",
            {"message": f"思维导图生成失败: {e}", "code": "MINDMAP_ERROR"},
        )
        await manager.broadcast(
            session_id,
            "MINDMAP_GENERATING",
            {"is_generating": False},
        )


async def handle_mindmap_edit(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理思维导图编辑操作（实时同步）。"""
    user_info = manager.get_user_info(websocket)
    if not user_info:
        await manager.send_error(websocket, "Not authenticated")
        return

    # 编辑操作类型：add_node, remove_node, update_node, add_edge, remove_edge
    operation = data.get("operation")
    payload = data.get("payload", {})

    if not operation:
        await manager.send_error(websocket, "Missing operation type")
        return

    # 广播给同组其他人（排除自己）
    await manager.broadcast(
        session_id,
        "MINDMAP_SYNC",
        {
            "operation": operation,
            "payload": payload,
            "user_id": user_info["user_id"],
            "user_name": user_info["user_name"],
        },
        exclude=websocket,
    )

    # 异步更新数据库
    asyncio.create_task(
        _update_mindmap_db(session_id, operation, payload)
    )


async def _update_mindmap_db(
    session_id: str, operation: str, payload: dict
) -> None:
    """异步更新数据库中的思维导图数据。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.mindmap import MindMap
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MindMap)
                .where(MindMap.session_id == session_id)
                .order_by(MindMap.updated_at.desc())
                .limit(1)
            )
            mindmap = result.scalar_one_or_none()
            if not mindmap:
                return

            nodes = list(mindmap.nodes)
            edges = list(mindmap.edges)

            if operation == "add_node":
                nodes.append(payload)
            elif operation == "remove_node":
                node_id = payload.get("id")
                nodes = [n for n in nodes if n["id"] != node_id]
                edges = [
                    e for e in edges
                    if e["source"] != node_id and e["target"] != node_id
                ]
            elif operation == "update_node":
                node_id = payload.get("id")
                for n in nodes:
                    if n["id"] == node_id:
                        n.update(payload)
                        break
            elif operation == "add_edge":
                edges.append(payload)
            elif operation == "remove_edge":
                edge_id = payload.get("id")
                edges = [e for e in edges if e["id"] != edge_id]

            mindmap.nodes = nodes
            mindmap.edges = edges
            mindmap.version += 1
            await db.commit()
    except Exception as e:
        logger.error("Mindmap DB update failed: %s", e)


async def handle_mindmap_accept_draft(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理用户确认 AI 草稿 — 写入 DB 并广播正式数据。"""
    user_info = manager.get_user_info(websocket)
    if not user_info:
        await manager.send_error(websocket, "Not authenticated")
        return

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    if not nodes:
        await manager.send_error(websocket, "Empty draft")
        return

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.mindmap import MindMap

        map_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            mindmap = MindMap(
                id=map_id,
                session_id=session_id,
                nodes=nodes,
                edges=edges,
                created_by=user_info["user_id"],
            )
            db.add(mindmap)
            await db.commit()

        # 广播正式数据给所有人
        await manager.broadcast(
            session_id,
            "MINDMAP_DATA",
            {
                "id": map_id,
                "session_id": session_id,
                "nodes": nodes,
                "edges": edges,
                "version": 1,
            },
        )
        logger.info(
            "Draft accepted by %s for session %s (map_id=%s)",
            user_info["user_id"], session_id, map_id,
        )

    except Exception as e:
        logger.error("Accept draft failed: %s", e)
        await manager.send_error(websocket, f"Failed to save draft: {e}")

