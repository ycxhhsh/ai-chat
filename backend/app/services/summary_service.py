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

# 工作记忆提炼 prompt
WORKING_MEMORY_PROMPT = (
    "你是一位记忆管理专家。请根据以下对话历史，提炼并更新该学生的【学习足迹与当前共识】。\n"
    "输出要求：\n"
    "1. 概括已讨论的核心知识点和学生展示出的理解水平。\n"
    "2. 记录学生提出的关键疑问或未解决的问题。\n"
    "3. 保持简练（200字以内），逻辑清晰。\n\n"
    "对话历史：\n{conversation_text}"
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


async def update_working_memory(
    conversation_id: str,
    llm_provider: str = "deepseek",
) -> Optional[str]:
    """异步更新对话的“工作记忆”。

    触发条件：总消息数 > 20 且距上次摘要新增消息 > 10。
    生成摘要并持久化到 AiConversation.working_memory。
    """
    from app.db.session import AsyncSessionLocal
    from app.models.ai_conversation import AiConversation
    from app.llm.factory import get_llm_client

    try:
        async with AsyncSessionLocal() as db:
            # 1. 获取会话信息
            result = await db.execute(
                select(AiConversation)
                .where(AiConversation.conversation_id == conversation_id)
            )
            convo = result.scalar_one_or_none()
            if not convo:
                return None

            current_count = convo.message_count
            last_summary_count = convo.msg_count_at_summary

            # 触发判断
            if current_count < 20 or (current_count - last_summary_count < 10):
                return convo.working_memory

            # 2. 加载消息（取最新的 100 条）
            result = await db.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.asc())
                .limit(100)
            )
            msgs = result.scalars().all()

            lines = []
            for m in msgs:
                sender = m.sender if isinstance(m.sender, dict) else {}
                role = "AI" if sender.get("role") == "ai" else sender.get("name", "学生")
                content = m.content[:200] + ("..." if len(m.content) > 200 else "")
                lines.append(f"[{role}] {content}")

            conversation_text = "\n".join(lines)

            # 3. 调用 LLM
            client = get_llm_client(llm_provider)
            prompt = WORKING_MEMORY_PROMPT.format(conversation_text=conversation_text)

            response = await client.chat(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.3,
            )
            summary_text = response.strip()

            if summary_text:
                convo.working_memory = summary_text
                convo.msg_count_at_summary = current_count
                await db.commit()
                logger.info(
                    "Updated working memory for conversation %s (count=%d)",
                    conversation_id, current_count,
                )
                return summary_text
    except Exception as e:
        logger.warning("Working memory update failed for %s: %s", conversation_id, e)

    return None
