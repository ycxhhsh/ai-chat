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
    """从对话中提取思维导图（论证线索树 + 全量替换）。

    流程：
      1. 获取全部对话消息
      2. LLM 一次性提取论证线索树 {topic, branches}
      3. 转换为 React Flow 节点/边
      4. 硬截断安全网
      5. 以草稿模式广播
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
        from app.llm.factory import get_llm_client
        from app.llm.prompts import MINDMAP_TREE_PROMPT
        from sqlalchemy import select

        effective_key = map_key or f"session:{session_id}"

        # ── 全量获取对话消息（新策略：每次全量重新生成）──
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

        # 自动触发时，消息太少则跳过
        if auto_trigger and len(messages) < 3:
            return

        # 构建对话文本
        conversation_text = "\n".join(
            f"[{m.sender.get('name', '未知')}]: {m.content}"
            for m in reversed(messages)
        )
        msg_count = len(messages)
        char_count = len(conversation_text)
        rounds = msg_count // 2  # 粗略算对话轮次

        # ── 单次 LLM 调用 ──
        client = get_llm_client("deepseek")
        llm_messages = [
            {"role": "system", "content": MINDMAP_TREE_PROMPT},
            {
                "role": "user",
                "content": (
                    f"[对话文本]（共 {rounds} 轮，{char_count} 字）：\n"
                    f"{conversation_text}"
                ),
            },
        ]

        full_response = ""
        try:
            async with asyncio.timeout(60.0):
                async for chunk in client.stream_chat(
                    messages=llm_messages, temperature=0.2,
                ):
                    full_response += chunk
        except TimeoutError:
            logger.error(
                "Mindmap LLM stream timeout (session=%s, chars=%d)",
                session_id, len(full_response),
            )
            if len(full_response) < 50:
                await manager.broadcast(
                    session_id,
                    "ERROR",
                    {"message": "思维导图生成超时，请稍后再试", "code": "MINDMAP_TIMEOUT"},
                )
                await manager.broadcast(
                    session_id, "MINDMAP_GENERATING", {"is_generating": False},
                )
                return

        logger.info(
            "Mindmap response (session=%s, rounds=%d, chars=%d): %s",
            session_id, rounds, char_count, full_response[:300],
        )

        # 解析 {name, children} 树
        tree = _parse_tree_json(full_response)
        if tree is None:
            logger.error("Failed to parse mindmap tree: %s", full_response[:300])
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

        # 转换为 React Flow 节点/边
        nodes, edges = _tree_to_nodes_edges(tree)

        # 硬截断安全网
        max_nodes = 3 if rounds <= 2 else (5 if rounds <= 5 else 8)
        nodes, edges = _hard_truncate(nodes, edges, max_nodes, [])

        # 树形布局
        _apply_tree_layout(nodes, edges)

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


def _hard_truncate(
    nodes: list[dict],
    edges: list[dict],
    max_nodes: int,
    existing_nodes: list[dict],
) -> tuple[list[dict], list[dict]]:
    """强制截断节点数，优先保留已有节点，清理悬挂边。"""
    if len(nodes) <= max_nodes:
        return nodes, edges

    existing_ids = {n.get("id") for n in existing_nodes}
    kept = [n for n in nodes if n.get("id") in existing_ids]
    new_nodes = [n for n in nodes if n.get("id") not in existing_ids]
    nodes = kept + new_nodes[: max(0, max_nodes - len(kept))]

    # 清理悬挂边（source/target 不在有效节点集合中）
    valid_ids = {n.get("id") for n in nodes}
    edges = [
        e for e in edges
        if e.get("source") in valid_ids and e.get("target") in valid_ids
    ]
    logger.info(
        "Hard truncate: %d nodes → %d (max=%d), edges=%d",
        len(kept) + len(new_nodes), len(nodes), max_nodes, len(edges),
    )
    return nodes, edges


def _parse_tree_json(raw: str) -> dict | None:
    """容错解析 LLM 返回的 {name, children} 树 JSON。"""
    import re
    import json

    raw = raw.strip()

    def _valid(data: object) -> dict | None:
        if isinstance(data, dict) and "name" in data:
            return data
        return None

    # 1. 直接解析
    try:
        r = _valid(json.loads(raw))
        if r:
            return r
    except json.JSONDecodeError:
        pass

    # 2. 提取代码块
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", raw, re.DOTALL)
    if m:
        try:
            r = _valid(json.loads(m.group(1).strip()))
            if r:
                return r
        except json.JSONDecodeError:
            pass

    # 3. 正则匹配最外层 {}
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            r = _valid(json.loads(m.group(0)))
            if r:
                return r
        except json.JSONDecodeError:
            pass

    return None


def _tree_to_nodes_edges(tree: dict) -> tuple[list[dict], list[dict]]:
    """将 {name, children} 递归树转换为 React Flow 节点和边。"""
    nodes: list[dict] = []
    edges: list[dict] = []
    _counter = [0]

    def _clip(text: str, max_len: int = 10) -> str:
        return text[:max_len] + "…" if len(text) > max_len else text

    def _walk(node: dict, parent_id: str | None, depth: int) -> None:
        _counter[0] += 1
        nid = f"n{_counter[0]}"
        label = _clip(node.get("name", ""), 10)
        if not label:
            return

        # 根据深度和位置决定节点类型
        if depth == 0:
            ntype = "concept"       # 根节点 → 紫色
        elif depth == 1:
            ntype = "argument"      # 一级子 → 琥珀色
        else:
            ntype = "evidence"      # 二级子 → 绿色

        nodes.append({"id": nid, "label": label, "type": ntype})

        if parent_id:
            rel = node.get("relationship", "")
            edges.append({
                "id": f"e_{parent_id}_{nid}",
                "source": parent_id,
                "target": nid,
                "label": _clip(rel, 4) if rel else "",
            })

        # 递归子节点（最多 2 层深度）
        if depth < 2:
            for child in node.get("children", []):
                _walk(child, nid, depth + 1)

    _walk(tree, None, 0)
    return nodes, edges


def _apply_tree_layout(
    nodes: list[dict],
    edges: list[dict],
) -> None:
    """为节点分配树形布局位置（就地修改）。

    布局：topic 顶部居中，branches 平铺第二层，children 平铺第三层。
    """
    if not nodes:
        return

    # 建立父子关系
    children_of: dict[str, list[str]] = {}
    for e in edges:
        src = e.get("source", "")
        tgt = e.get("target", "")
        children_of.setdefault(src, []).append(tgt)

    node_map = {n["id"]: n for n in nodes}
    topic_id = nodes[0]["id"]  # 第一个总是 topic

    # L1: topic
    node_map[topic_id]["position"] = {"x": 400, "y": 50}

    # L2: branches
    l2_ids = children_of.get(topic_id, [])
    l2_count = len(l2_ids)
    l2_spacing = 400
    l2_start_x = 400 - (l2_count - 1) * l2_spacing / 2

    for i, bid in enumerate(l2_ids):
        if bid not in node_map:
            continue
        bx = l2_start_x + i * l2_spacing
        node_map[bid]["position"] = {"x": bx, "y": 220}

        # L3: children of this branch
        l3_ids = children_of.get(bid, [])
        l3_count = len(l3_ids)
        l3_spacing = 280
        l3_start_x = bx - (l3_count - 1) * l3_spacing / 2

        for j, cid in enumerate(l3_ids):
            if cid not in node_map:
                continue
            node_map[cid]["position"] = {
                "x": l3_start_x + j * l3_spacing,
                "y": 400,
            }


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
    """将操作指令应用到已有节点和边上（含标签去重）。"""
    nodes = list(existing_nodes)
    edges = list(existing_edges)
    node_ids = {n.get("id") for n in nodes}
    # 标签去重索引：小写 label -> node id
    label_index: dict[str, str] = {
        n.get("label", "").strip().lower(): n.get("id", "")
        for n in nodes if n.get("label")
    }

    for op in operations:
        op_type = op.get("op", "")

        if op_type == "add_node":
            node_id = op.get("id", "")
            label = op.get("label", "").strip()
            label_key = label.lower()
            if not node_id:
                continue
            # 标签去重：如果已有节点的 label 完全相同，跳过
            if label_key in label_index:
                logger.info(
                    "Dedup: skip node %s (%s), same label as %s",
                    node_id, label, label_index[label_key],
                )
                continue
            if node_id not in node_ids:
                nodes.append({
                    "id": node_id,
                    "label": label,
                    "type": op.get("type", "concept"),
                    "source_message_ids": op.get("source_message_ids", []),
                })
                node_ids.add(node_id)
                label_index[label_key] = node_id

        elif op_type == "update_node":
            node_id = op.get("id", "")
            for n in nodes:
                if n.get("id") == node_id:
                    if "label" in op:
                        old_label = n.get("label", "").strip().lower()
                        if old_label in label_index:
                            del label_index[old_label]
                        n["label"] = op["label"]
                        label_index[op["label"].strip().lower()] = node_id
                    break

        elif op_type == "add_edge":
            src = op.get("source", "")
            tgt = op.get("target", "")
            label = op.get("label", "")
            if src and tgt:
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

