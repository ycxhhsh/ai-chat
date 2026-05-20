"""学习分析服务 — 参与度热力图 + Bloom 思维层次 + 词云。"""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import Integer, func, select, cast, String as SAString
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group
from app.models.message import Message
from app.db.json_utils import jq, jq_truthy

logger = logging.getLogger(__name__)

# jieba 分词（可选依赖，降级为简单空格分词）
try:
    import jieba
    _HAS_JIEBA = True
except ImportError:
    _HAS_JIEBA = False
    logger.info("jieba not installed, word cloud will use basic tokenization")

# 中文停用词
_STOP_WORDS = frozenset(
    "的 了 是 我 你 他 她 它 们 这 那 有 在 不 和 与 就 也 都 要 会 "
    "可以 可能 没有 什么 怎么 为什么 如何 还是 或者 但是 因为 所以 "
    "吗 呢 啊 哦 嗯 好 对 哈 嘿 呀 吧 噢 一个 一些 很 非常 比较 "
    "the a an is are was were be been being have has had do does did "
    "will would shall should may might can could to of in for on with".split()
)



async def build_participation_heatmap(db: AsyncSession) -> list[dict]:
    """参与度热力图：学生 × 日期 → 消息数。"""
    try:
        student_name = jq(Message.sender, "name")
        student_id = jq(Message.sender, "id")
        student_role = jq(Message.sender, "role")
        activity_date = cast(func.date(Message.created_at), SAString)
        result = await db.execute(
            select(
                student_name.label("student_name"),
                student_id.label("student_id"),
                activity_date.label("date"),
                func.count().label("count"),
            )
            .where(student_role == "student")
            .group_by(student_id, student_name, activity_date)
            .order_by(activity_date)
        )
        return [
            {
                "student_name": row.student_name,
                "student_id": row.student_id,
                "date": row.date,
                "count": row.count,
            }
            for row in result
        ]
    except Exception as e:
        logger.warning("Participation heatmap failed: %s", e)
        return []


async def build_word_cloud(db: AsyncSession, limit: int = 100) -> list[dict]:
    """词云：对学生消息做分词 + 频次统计，返回 top N。"""
    try:
        student_role = jq(Message.sender, "role")
        result = await db.execute(
            select(Message.content)
            .where(student_role == "student")
            .order_by(Message.created_at.desc())
            .limit(2000)  # 最多取最近 2000 条
        )
        texts = [row[0] for row in result if row[0]]

        counter: Counter = Counter()
        for text in texts:
            if _HAS_JIEBA:
                words = jieba.lcut(text)
            else:
                # 降级：按标点和空格分词
                words = re.split(r"[\s，。！？、；：“”‘’（）\[\]【】{}.,!?;:'\"()\n\r]+", text)

            for w in words:
                w = w.strip().lower()
                if len(w) >= 2 and w not in _STOP_WORDS:
                    counter[w] += 1

        return [
            {"word": word, "count": count}
            for word, count in counter.most_common(limit)
        ]
    except Exception as e:
        logger.warning("Word cloud build failed: %s", e)
        return []


# Bloom 思维层次（预留，初期用 LLM 手动触发分析）
BLOOM_LEVELS = ["记忆", "理解", "应用", "分析", "评价", "创造"]

BLOOM_PROMPT = """请对以下学生发言进行 Bloom 认知层次分类。
每条发言只需返回一个层次，从以下六个中选一个：记忆、理解、应用、分析、评价、创造。

学生发言列表：
{messages}

请严格按 JSON 数组格式返回，每个元素对应一条发言的层次，例如：
["理解", "分析", "记忆", ...]
"""


async def run_bloom_analysis(
    db: AsyncSession,
    llm_client,
    limit: int = 50,
) -> dict:
    """LLM 驱动的 Bloom 认知层次分析。

    Returns:
        {"levels": {"记忆": 5, ...}, "total": N, "details": [...]}
    """
    import json as _json

    # 1. 获取最近学生消息
    result = await db.execute(
        select(
            Message.content,
            jq(Message.sender, 'name').label("student_name"),
        )
        .where(jq(Message.sender, 'role') == "student")
        .where(Message.content.isnot(None))
        .where(Message.content != "")
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    rows = list(result)
    if not rows:
        return {"levels": {}, "total": 0, "details": [], "error": "暂无学生发言数据"}

    # 2. 构建消息列表
    messages_text = "\n".join(
        f"{i + 1}. [{r.student_name}] {r[0][:100]}"
        for i, r in enumerate(rows)
    )

    prompt = BLOOM_PROMPT.format(messages=messages_text)

    # 3. 调用 LLM（收集完整流）
    full_response = ""
    try:
        async for chunk in llm_client.stream_chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        ):
            full_response += chunk
    except Exception as e:
        logger.error("Bloom LLM call failed: %s", e)
        return {"levels": {}, "total": len(rows), "details": [], "error": str(e)}

    # 4. 解析 JSON 数组
    try:
        # 提取 JSON 部分（LLM 可能返回 markdown 包裹）
        json_str = full_response.strip()
        if "```" in json_str:
            # 提取 code block 内容
            start = json_str.find("[")
            end = json_str.rfind("]") + 1
            json_str = json_str[start:end]
        levels_list: list[str] = _json.loads(json_str)
    except Exception as e:
        logger.warning("Bloom JSON parse failed: %s | raw: %s", e, full_response[:200])
        return {"levels": {}, "total": len(rows), "details": [], "error": "LLM 返回格式异常"}

    # 5. 统计
    level_counts: dict[str, int] = {lv: 0 for lv in BLOOM_LEVELS}
    details: list[dict] = []

    for i, (row, level) in enumerate(zip(rows, levels_list)):
        level = level.strip() if isinstance(level, str) else str(level)
        if level in level_counts:
            level_counts[level] += 1
        details.append({
            "content": row[0][:80],
            "student": row.student_name,
            "level": level,
        })

    return {
        "levels": level_counts,
        "total": len(rows),
        "details": details[:20],
    }


async def build_mindmap_depth_stats(db: AsyncSession) -> list[dict]:
    """P1: 思维导图深度统计 — 每个小组的 AI 提取节点数。

    通过统计 metadata_info 中 mindmap_node_count 字段近似推算。
    """
    try:
        node_count = cast(jq(Message.metadata_info, "mindmap_node_count"), Integer)
        is_extraction = jq_truthy(Message.metadata_info, "is_mindmap_extraction")
        result = await db.execute(
            select(
                Message.session_id,
                func.sum(func.coalesce(node_count, 0)).label("total_nodes"),
                func.count().label("extraction_count"),
            )
            .where(is_extraction)
            .group_by(Message.session_id)
        )
        return [
            {
                "session_id": row.session_id,
                "total_nodes": int(row.total_nodes or 0),
                "extraction_count": row.extraction_count,
            }
            for row in result
        ]
    except Exception as e:
        logger.warning("Mindmap depth stats failed: %s", e)
        return []


async def build_teacher_analytics(db: AsyncSession) -> dict:
    """Build teacher analytics with PostgreSQL-safe grouping expressions."""

    scaffold_heatmap = []
    try:
        scaffold_name = jq(Message.metadata_info, "scaffold_info", "name")
        scaffold_used = jq_truthy(Message.metadata_info, "is_scaffold_used")
        result = await db.execute(
            select(
                scaffold_name.label("scaffold_name"),
                func.count().label("usage_count"),
            )
            .where(scaffold_used)
            .group_by(scaffold_name)
        )
        scaffold_heatmap = [
            {"scaffold_name": row.scaffold_name, "count": row.usage_count}
            for row in result
            if row.scaffold_name
        ]
    except Exception as e:
        logger.warning("Scaffold heatmap query failed: %s", e)
        await db.rollback()

    ai_intervention_rate = []
    try:
        sender_id = jq(Message.sender, "id")
        sender_name = jq(Message.sender, "name")
        sender_role = jq(Message.sender, "role")
        student_msgs = await db.execute(
            select(
                sender_id.label("uid"),
                sender_name.label("uname"),
                func.count().label("total"),
            )
            .where(sender_role == "student")
            .group_by(sender_id, sender_name)
        )
        student_msg_data = {
            row.uid: {"name": row.uname, "total": row.total}
            for row in student_msgs
        }

        ai_replies = await db.execute(
            select(
                Message.recipient_id.label("uid"),
                func.count().label("ai_count"),
            )
            .where(
                sender_role == "ai",
                Message.recipient_id.is_not(None),
            )
            .group_by(Message.recipient_id)
        )
        ai_reply_map = {row.uid: row.ai_count for row in ai_replies}

        for uid, data in student_msg_data.items():
            ai_count = ai_reply_map.get(uid, 0)
            total = data["total"] + ai_count
            ai_intervention_rate.append({
                "user_id": uid,
                "student_name": data["name"],
                "student_messages": data["total"],
                "ai_replies": ai_count,
                "ai_ratio": round(ai_count / total * 100, 1) if total > 0 else 0,
            })

        ai_intervention_rate.sort(key=lambda x: x["ai_ratio"], reverse=True)
    except Exception as e:
        logger.warning("AI intervention rate query failed: %s", e)
        await db.rollback()

    participation_curve = []
    try:
        activity_date = cast(func.date(Message.created_at), SAString)
        result = await db.execute(
            select(
                activity_date.label("day"),
                func.count().label("count"),
            )
            .group_by(activity_date)
            .order_by(activity_date)
            .limit(30)
        )
        participation_curve = [
            {"date": row.day, "count": row.count}
            for row in result
        ]
    except Exception as e:
        logger.warning("Participation curve query failed: %s", e)
        await db.rollback()

    discussion_depth = []
    try:
        sender_id = jq(Message.sender, "id")
        sender_name = jq(Message.sender, "name")
        sender_role = jq(Message.sender, "role")
        avg_length = func.avg(func.length(Message.content))
        result = await db.execute(
            select(
                sender_name.label("name"),
                avg_length.label("avg_length"),
                func.count().label("msg_count"),
            )
            .where(sender_role == "student")
            .group_by(sender_id, sender_name)
            .order_by(avg_length.desc())
        )
        discussion_depth = [
            {
                "name": row.name,
                "avg_length": round(row.avg_length or 0, 0),
                "count": row.msg_count,
            }
            for row in result
        ]
    except Exception as e:
        logger.warning("Discussion depth query failed: %s", e)
        await db.rollback()

    scaffold_dependency = {"total": 0, "scaffold_used": 0, "rate": 0}
    try:
        sender_role = jq(Message.sender, "role")
        scaffold_used = jq_truthy(Message.metadata_info, "is_scaffold_used")
        total_student_msgs = (
            await db.execute(
                select(func.count()).where(sender_role == "student")
            )
        ).scalar() or 0

        scaffold_used_msgs = (
            await db.execute(
                select(func.count()).where(
                    sender_role == "student",
                    scaffold_used,
                )
            )
        ).scalar() or 0

        scaffold_dependency = {
            "total": total_student_msgs,
            "scaffold_used": scaffold_used_msgs,
            "rate": (
                round(scaffold_used_msgs / total_student_msgs * 100, 1)
                if total_student_msgs else 0
            ),
        }
    except Exception as e:
        logger.warning("Scaffold dependency query failed: %s", e)
        await db.rollback()

    active_sessions = []
    try:
        last_activity = func.max(Message.created_at)
        result = await db.execute(
            select(
                Message.session_id,
                func.count().label("message_count"),
                last_activity.label("last_activity"),
            )
            .group_by(Message.session_id)
            .order_by(last_activity.desc())
            .limit(10)
        )
        active_sessions = [
            {
                "session_id": row.session_id,
                "message_count": row.message_count,
                "last_activity": (
                    row.last_activity.isoformat()
                    if row.last_activity else ""
                ),
            }
            for row in result
        ]
    except Exception as e:
        logger.warning("Active sessions query failed: %s", e)
        await db.rollback()

    if active_sessions:
        try:
            session_ids = [s["session_id"] for s in active_sessions]
            group_result = await db.execute(
                select(Group.id, Group.name).where(Group.id.in_(session_ids))
            )
            group_map = {row.id: row.name for row in group_result}
            for session in active_sessions:
                session["group_name"] = group_map.get(
                    session["session_id"],
                    session["session_id"][:12] + "...",
                )
        except Exception as e:
            logger.warning("Group name lookup failed: %s", e)
            await db.rollback()
            for session in active_sessions:
                session["group_name"] = session["session_id"][:12] + "..."

    participation_heatmap = []
    try:
        participation_heatmap = await build_participation_heatmap(db)
    except Exception as e:
        logger.warning("Participation heatmap wrapper failed: %s", e)
        await db.rollback()

    word_cloud = []
    try:
        word_cloud = await build_word_cloud(db)
    except Exception as e:
        logger.warning("Word cloud wrapper failed: %s", e)
        await db.rollback()

    mindmap_depth = []
    try:
        mindmap_depth = await build_mindmap_depth_stats(db)
    except Exception as e:
        logger.warning("Mindmap depth stats wrapper failed: %s", e)
        await db.rollback()

    return {
        "scaffold_usage": scaffold_heatmap,
        "ai_intervention_rate": ai_intervention_rate,
        "participation_trend": participation_curve,
        "discussion_depth": discussion_depth,
        "scaffold_dependency": scaffold_dependency,
        "active_sessions": active_sessions,
        "participation_heatmap": participation_heatmap,
        "word_cloud": word_cloud,
        "mindmap_depth": mindmap_depth,
    }

