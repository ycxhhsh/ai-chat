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

    map_key = data.get("map_key") or f"session:{session_id}"

    asyncio.create_task(
        _generate_mindmap(session_id, user_info, manager, map_key=map_key)
    )


async def _generate_mindmap(
    session_id: str,
    user_info: dict,
    manager: ConnectionManager,
    *,
    auto_trigger: bool = False,
    map_key: str = "",
) -> None:
    """从对话中提取思维导图（Tool Calling 操作指令模式）。

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
                .limit(30)
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
        effective_key = map_key or f"session:{session_id}"
        existing_nodes: list[dict] = []
        existing_edges: list[dict] = []
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MindMap)
                .where(MindMap.map_key == effective_key)
                .order_by(MindMap.updated_at.desc())
                .limit(1)
            )
            existing_map = result.scalar_one_or_none()
            if existing_map and existing_map.nodes:
                existing_nodes = list(existing_map.nodes)
                existing_edges = list(existing_map.edges)

        # 构建对话文本（注入 message_id 以便 AI 节点溯源）
        conversation_text = "\n".join(
            f"[MsgID:{m.message_id}] [{m.sender.get('name', '未知')}]: {m.content}"
            for m in reversed(messages)
        )

        # 构建增量上下文
        existing_context = ""
        if existing_nodes:
            existing_ids = [n.get("id", "") for n in existing_nodes]
            existing_context = (
                "\n\n当前已有节点 ID: " + ", ".join(existing_ids)
                + "\n请在此基础上增量更新（可用 update_node 修改已有节点，或 add_node 添加新节点）。"
            )

        # 调用 LLM 提取操作指令
        client = get_llm_client("deepseek")
        llm_messages = [
            {"role": "system", "content": MINDMAP_EXTRACTION_PROMPT},
            {"role": "user", "content": f"对话内容：\n{conversation_text}{existing_context}"},
        ]

        full_response = ""
        async for chunk in client.stream_chat(messages=llm_messages, temperature=0.3):
            full_response += chunk

        # 多层 JSON 解析容错
        operations = _parse_operations_json(full_response)
        if operations is None:
            logger.error("Failed to parse mindmap operations: %s", full_response[:300])
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

        # 将操作指令应用到已有节点/边
        nodes, edges = _apply_operations(operations, existing_nodes, existing_edges)

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
                "map_key": effective_key,
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


def _parse_operations_json(raw: str) -> list[dict] | None:
    """多层容错解析 LLM 返回的操作指令 JSON。

    尝试顺序：
    1. 直接 json.loads（最理想情况）
    2. 提取 ```json...``` 代码块
    3. 正则匹配最外层 [...] 数组
    4. 尝试匹配 {nodes, edges} 旧格式并转换
    """
    import re

    raw = raw.strip()

    # 1. 直接解析
    try:
        result = json.loads(raw)
        if isinstance(result, list):
            return result
        # 兼容旧格式 {nodes, edges}
        if isinstance(result, dict) and "nodes" in result:
            return _convert_legacy_format(result)
    except json.JSONDecodeError:
        pass

    # 2. 提取 markdown 代码块
    if "```" in raw:
        try:
            parts = raw.split("```")
            for part in parts[1::2]:  # 奇数索引为代码块内容
                cleaned = part.strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()
                result = json.loads(cleaned)
                if isinstance(result, list):
                    return result
                if isinstance(result, dict) and "nodes" in result:
                    return _convert_legacy_format(result)
        except (json.JSONDecodeError, IndexError):
            pass

    # 3. 正则匹配最外层 [...]
    match = re.search(r'\[[\s\S]*\]', raw)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    # 4. 正则匹配 {...}（旧格式兜底）
    match = re.search(r'\{[\s\S]*\}', raw)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result, dict) and "nodes" in result:
                return _convert_legacy_format(result)
        except json.JSONDecodeError:
            pass

    return None


def _convert_legacy_format(data: dict) -> list[dict]:
    """将旧的 {nodes, edges} 格式转换为操作指令数组。"""
    ops: list[dict] = []
    for node in data.get("nodes", []):
        ops.append({
            "op": "add_node",
            "id": node.get("id", f"n{len(ops)}"),
            "label": node.get("label", ""),
            "type": node.get("type", "concept"),
            "source_message_ids": node.get("source_message_ids", []),
        })
    for edge in data.get("edges", []):
        ops.append({
            "op": "add_edge",
            "source": edge.get("source", ""),
            "target": edge.get("target", ""),
            "label": edge.get("label", ""),
        })
    return ops


def _apply_operations(
    operations: list[dict],
    existing_nodes: list[dict],
    existing_edges: list[dict],
) -> tuple[list[dict], list[dict]]:
    """将操作指令应用到已有节点和边上。"""
    nodes = list(existing_nodes)
    edges = list(existing_edges)
    node_ids = {n.get("id") for n in nodes}

    for op in operations:
        op_type = op.get("op", "")

        if op_type == "add_node":
            node_id = op.get("id", "")
            if node_id and node_id not in node_ids:
                nodes.append({
                    "id": node_id,
                    "label": op.get("label", ""),
                    "type": op.get("type", "concept"),
                    "source_message_ids": op.get("source_message_ids", []),
                })
                node_ids.add(node_id)

        elif op_type == "update_node":
            node_id = op.get("id", "")
            for n in nodes:
                if n.get("id") == node_id:
                    if "label" in op:
                        n["label"] = op["label"]
                    break

        elif op_type == "add_edge":
            src = op.get("source", "")
            tgt = op.get("target", "")
            label = op.get("label", "")
            if src and tgt:
                # 避免重复边
                exists = any(
                    e.get("source") == src and e.get("target") == tgt
                    for e in edges
                )
                if not exists:
                    edges.append({
                        "id": f"e_{src}_{tgt}",
                        "source": src,
                        "target": tgt,
                        "label": label,
                    })

    return nodes, edges


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
    map_key = data.get("map_key") or f"session:{session_id}"

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
            "map_key": map_key,
            "user_id": user_info["user_id"],
            "user_name": user_info["user_name"],
        },
        exclude=websocket,
    )

    # 异步更新数据库
    asyncio.create_task(
        _update_mindmap_db(map_key, operation, payload)
    )


async def _update_mindmap_db(
    map_key: str, operation: str, payload: dict
) -> None:
    """异步更新数据库中的思维导图数据。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.mindmap import MindMap
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MindMap)
                .where(MindMap.map_key == map_key)
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
    map_key = data.get("map_key") or f"session:{session_id}"

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
                map_key=map_key,
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
                "map_key": map_key,
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

