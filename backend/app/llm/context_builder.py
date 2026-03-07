"""三明治上下文组装器 — 铁律 3 核心组件。

按严格顺序组装发送给 LLM 的 messages 数组：
1. [TOP / PINNED]    : System Prompt + 学生上传的文件全文（绝对不截断）
2. [MIDDLE / RAG]    : pgvector 检索的教材切片（按需插入）
3. [BOTTOM / SLIDING]: 对话历史（触顶时从最旧开始剔除）

Token 预算分配：
- Pinned 区：无上限（铁律：不截断）
- RAG 区：最多占总预算的 20%
- Sliding 区：剩余全部空间
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# 各模型的 Token 上限（保守估计，留 buffer 给输出）
MODEL_TOKEN_LIMITS: dict[str, int] = {
    "deepseek": 60_000,
    "kimi": 120_000,
    "doubao": 30_000,
    "zhipu": 120_000,
    "tongyi": 60_000,
    "openai": 120_000,
}

DEFAULT_TOKEN_LIMIT = 30_000

# 粗略估算：1 个中文字符 ≈ 1.5 tokens，1 个英文单词 ≈ 1.3 tokens
CHARS_PER_TOKEN = 2.5  # 保守估计


def estimate_tokens(text: str) -> int:
    """粗略估算文本的 Token 数量。"""
    return max(1, int(len(text) / CHARS_PER_TOKEN))


def estimate_messages_tokens(messages: list[dict[str, str]]) -> int:
    """估算 messages 数组的总 Token 数。"""
    return sum(estimate_tokens(m.get("content", "")) + 4 for m in messages)


async def build_sandwich_context(
    *,
    session_id: str,
    user_message: str,
    system_prompt: str,
    llm_provider: str = "deepseek",
    scaffold_prompt: str | None = None,
    uploaded_file_text: str | None = None,
    max_history: int = 50,
    user_id: str | None = None,
    conversation_id: str | None = None,
) -> list[dict[str, str]]:
    """组装三明治上下文。

    Args:
        session_id: 当前会话 ID
        user_message: 用户最新消息
        system_prompt: 基础 system prompt（MENTOR/ASSISTANT）
        llm_provider: LLM 提供商名称（用于确定 Token 上限）
        scaffold_prompt: 可选的支架 prompt
        uploaded_file_text: 学生上传的文件全文
        max_history: 最大历史消息条数

    Returns:
        组装好的 messages 数组
    """
    token_limit = MODEL_TOKEN_LIMITS.get(llm_provider, DEFAULT_TOKEN_LIMIT)
    messages: list[dict[str, str]] = []

    # ═══════════════════════════════════════════
    # 第 1 层：PINNED（绝对不截断）
    # ═══════════════════════════════════════════

    # 1a. System Prompt
    full_system = system_prompt

    # 1b. 支架引导
    if scaffold_prompt:
        full_system += (
            f"\n\n[当前激活支架提示]\n"
            f"学生正在使用以下思维支架，请围绕该支架的引导方向展开回复：\n"
            f"{scaffold_prompt}\n"
        )

    messages.append({"role": "system", "content": full_system})

    # 1c. 学生上传的文件全文（锚定到 Pinned 区，永不截断）
    if uploaded_file_text:
        messages.append({
            "role": "system",
            "content": f"### 学生上传的参考文件全文：\n{uploaded_file_text}",
        })

    pinned_tokens = estimate_messages_tokens(messages)

    # 1d. 跨窗口对话摘要（轻量跨会话记忆）
    if user_id:
        try:
            from app.services.summary_service import load_user_summaries
            summaries = await load_user_summaries(
                user_id, limit=10,
                exclude_conversation_id=conversation_id,
            )
            if summaries:
                summary_text = "\n".join(
                    f"[历史对话{i+1}] {s}" for i, s in enumerate(summaries)
                )
                messages.append({
                    "role": "system",
                    "content": f"=== 该学生此前讨论摘要 ===\n{summary_text}",
                })
                pinned_tokens = estimate_messages_tokens(messages)
        except Exception as e:
            logger.warning("Cross-conversation summary injection failed: %s", e)

    # ═══════════════════════════════════════════
    # 第 2 层：RAG（动态检索切片）
    # ═══════════════════════════════════════════

    rag_tokens = 0
    rag_budget = int(token_limit * 0.2)  # 最多 20% 给 RAG

    rag_context = await _safe_rag_context(user_message)
    if rag_context:
        rag_msg = {
            "role": "system",
            "content": f"### 教师教材相关检索片段：\n{rag_context}",
        }
        rag_tokens = estimate_tokens(rag_msg["content"])
        if rag_tokens <= rag_budget:
            messages.append(rag_msg)
        else:
            # RAG 太长，截断到预算内
            max_chars = int(rag_budget * CHARS_PER_TOKEN)
            messages.append({
                "role": "system",
                "content": (
                    f"### 教师教材相关检索片段：\n"
                    f"{rag_context[:max_chars]}\n[因篇幅限制已截断]"
                ),
            })
            rag_tokens = rag_budget

    # ═══════════════════════════════════════════
    # 第 3 层：SLIDING WINDOW（对话历史）
    # ═══════════════════════════════════════════

    # 计算历史可用的 Token 预算
    current_msg_tokens = estimate_tokens(user_message) + 4
    history_budget = token_limit - pinned_tokens - rag_tokens - current_msg_tokens
    history_budget = max(0, history_budget)

    # 加载历史消息
    history = await _load_recent_messages(session_id, limit=max_history)

    # 从最新往最旧装填，超预算就停止
    history_messages: list[dict[str, str]] = []
    used_tokens = 0

    for msg in reversed(history):
        sender = msg.sender if isinstance(msg.sender, dict) else {}
        role = "assistant" if sender.get("role") == "ai" else "user"
        name = sender.get("name", "")
        # 只给用户消息加名字前缀，AI 回复不加——避免 LLM 学习并输出 "[AI 助教]"
        if role == "user" and name:
            content = f"[{name}] {msg.content}"
        else:
            content = msg.content
        msg_tokens = estimate_tokens(content) + 4

        if used_tokens + msg_tokens > history_budget:
            break  # 超预算，剔除更旧的

        history_messages.insert(0, {"role": role, "content": content})
        used_tokens += msg_tokens

    messages.extend(history_messages)

    # ═══════════════════════════════════════════
    # 第 4 层：当前用户最新消息
    # ═══════════════════════════════════════════

    messages.append({"role": "user", "content": user_message})

    total_tokens = estimate_messages_tokens(messages)
    logger.info(
        "Sandwich context built: pinned=%d, rag=%d, history=%d msgs, "
        "total≈%d tokens (limit=%d, provider=%s)",
        pinned_tokens, rag_tokens, len(history_messages),
        total_tokens, token_limit, llm_provider,
    )

    return messages


async def _safe_rag_context(query: str) -> Optional[str]:
    """RAG 检索包装器，失败时返回 None。"""
    try:
        from app.services.knowledge_service import build_rag_context
        return await build_rag_context(query)
    except Exception as e:
        logger.warning("RAG context injection failed: %s", e)
        return None


async def _load_recent_messages(session_id: str, limit: int = 50) -> list:
    """从数据库加载最近 N 条消息作为对话上下文。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.message import Message
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.created_at.desc())
                .limit(limit)
            )
            msgs = result.scalars().all()
            return list(reversed(msgs))
    except Exception as e:
        logger.warning("Failed to load recent messages: %s", e)
        return []


async def load_pinned_file_text(session_id: str) -> Optional[str]:
    """加载当前会话中学生上传的文件全文（用于 Pinned 区锚定）。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.document import Document
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Document.content)
                .where(Document.source_file.like(f"%{session_id}%"))
                .order_by(Document.created_at.desc())
                .limit(1)
            )
            content = result.scalar_one_or_none()
            return content
    except Exception as e:
        logger.warning("Failed to load pinned file: %s", e)
        return None
