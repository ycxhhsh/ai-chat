"""学习分析服务 — 参与度热力图 + Bloom 思维层次 + 词云。"""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import func, select, cast, String as SAString
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.db.json_utils import jq

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
        result = await db.execute(
            select(
                jq(Message.sender, 'name').label("student_name"),
                jq(Message.sender, 'id').label("student_id"),
                cast(func.date(Message.created_at), SAString).label("date"),
                func.count().label("count"),
            )
            .where(jq(Message.sender, 'role') == "student")
            .group_by(
                jq(Message.sender, 'id'),
                jq(Message.sender, 'name'),
                func.date(Message.created_at),
            )
            .order_by(func.date(Message.created_at))
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
        result = await db.execute(
            select(Message.content)
            .where(jq(Message.sender, 'role') == "student")
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
                words = re.split(r'[\s，。！？、；：""''（）\[\]【】{}.,!?;:\'"()\n\r]+', text)

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

