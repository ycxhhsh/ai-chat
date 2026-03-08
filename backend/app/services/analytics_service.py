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
