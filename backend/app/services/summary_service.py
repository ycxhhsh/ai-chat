"""对话摘要服务 — 生成 & 加载跨窗口摘要。"""
from __future__ import annotations

import json
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation_summary import ConversationSummary
from app.models.message import Message

logger = logging.getLogger(__name__)

# 摘要生成 prompt
SUMMARY_PROMPT = (
    "请用一句话（50-100字）总结以下对话的核心内容和学生的主要观点/收获，"
    "重点关注学生讨论了什么话题、得出了什么结论。\n\n"
    "对话内容：\n{conversation_text}"
)


async def generate_conversation_summary(
    conversation_id: str,
    user_id: str,
    db: AsyncSession | None = None,
) -> Optional[str]:
    """为指定对话生成一句话摘要并存入数据库。

    跳过条件：
    - 对话已有摘要
    - 对话消息 < 4 条

    可在 asyncio.create_task 中安全调用（自管 db session）。
    """
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as _db:
        session = _db

        # 检查是否已有摘要
        existing = await session.execute(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
        )
        if existing.scalar_one_or_none():
            return None  # 已有摘要，跳过

        # 加载对话消息
        result = await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
            .limit(100)
        )
        msgs = result.scalars().all()

        if len(msgs) < 4:
            return None  # 消息太少，不值得摘要

        # 组装对话文本
        lines = []
        for m in msgs:
            sender = m.sender if isinstance(m.sender, dict) else {}
            role = "AI" if sender.get("role") == "ai" else sender.get("name", "学生")
            lines.append(f"[{role}] {m.content}")
        conversation_text = "\n".join(lines[-30:])  # 最多取最后 30 条

        # 调用 LLM 生成摘要
        try:
            from app.llm.factory import get_llm_client
            client = get_llm_client("deepseek")  # 用最便宜的模型
            prompt = SUMMARY_PROMPT.format(conversation_text=conversation_text)

            response = await client.chat(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
            )
            summary_text = response.strip()

            if not summary_text or len(summary_text) < 10:
                return None

            # 存入数据库
            record = ConversationSummary(
                user_id=user_id,
                conversation_id=conversation_id,
                summary=summary_text,
            )
            session.add(record)
            await session.commit()

            logger.info(
                "Generated summary for conversation %s: %s",
                conversation_id, summary_text[:60],
            )
            return summary_text

        except Exception as e:
            logger.warning("Summary generation failed for %s: %s", conversation_id, e)
            return None


async def load_user_summaries(
    user_id: str,
    limit: int = 10,
    exclude_conversation_id: str | None = None,
) -> list[str]:
    """加载学生最近 N 条对话摘要，用于注入到新对话的 system prompt 中。"""
    try:
        from app.db.session import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            q = (
                select(ConversationSummary.summary)
                .where(ConversationSummary.user_id == user_id)
                .order_by(ConversationSummary.created_at.desc())
                .limit(limit)
            )
            if exclude_conversation_id:
                q = q.where(
                    ConversationSummary.conversation_id != exclude_conversation_id
                )

            result = await db.execute(q)
            return [row[0] for row in result]
    except Exception as e:
        logger.warning("Failed to load user summaries: %s", e)
        return []
