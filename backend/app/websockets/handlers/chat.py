"""Chat WS 事件处理。"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from app.websockets.manager import ConnectionManager

logger = logging.getLogger(__name__)

# Risk 4: AI 请求限流配置
AI_RATE_LIMIT_MAX = 5       # 每用户最多 N 次
AI_RATE_LIMIT_WINDOW = 60   # 时间窗口（秒）


async def _check_ai_rate_limit(user_id: str) -> bool:
    """Redis 滑动窗口限流：每用户每 60s 最多 5 次 AI 请求。

    Returns:
        True = 放行，False = 限流
    """
    import time

    try:
        from app.infra.redis_client import get_redis
        redis = get_redis()
        if not redis:
            return True  # 无 Redis 时降级放行

        key = f"rate:ai:{user_id}"
        now = time.time()
        window_start = now - AI_RATE_LIMIT_WINDOW

        pipe = redis.pipeline()
        # 清除过期记录
        pipe.zremrangebyscore(key, 0, window_start)
        # 统计窗口内请求数
        pipe.zcard(key)
        # 添加当前请求
        pipe.zadd(key, {str(now): now})
        # 设置过期（兜底清理）
        pipe.expire(key, AI_RATE_LIMIT_WINDOW + 10)
        results = await pipe.execute()

        current_count = results[1]
        if current_count >= AI_RATE_LIMIT_MAX:
            logger.warning(
                "AI rate limit exceeded: user=%s count=%d",
                user_id, current_count,
            )
            return False

        return True

    except Exception as e:
        logger.warning("Rate limit check failed: %s", e)
        return True  # 出错时降级放行


async def handle_chat_send(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理 CHAT_SEND 事件。"""
    user_info = manager.get_user_info(websocket)
    if not user_info:
        await manager.send_error(websocket, "Not authenticated")
        return

    content = data.get("content", "").strip()
    if not content:
        await manager.send_error(websocket, "Content cannot be empty")
        return

    request_id = data.get("request_id")
    target_user = data.get("target_user")
    metadata = data.get("metadata", {})
    llm_provider = data.get("llm_provider", "deepseek")
    conversation_id = data.get("conversation_id")  # AI 对话会话 ID

    # 构造消息
    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    message = {
        "message_id": msg_id,
        "session_id": session_id,
        "sender": {
            "id": user_info["user_id"],
            "name": user_info["user_name"],
            "role": user_info["role"],
        },
        "content": content,
        "timing": {
            "absolute_time": now.isoformat(),
            "relative_minute": 0,
        },
        "metadata_info": metadata,
        "created_at": now.isoformat(),
        "recipient_id": target_user,
        "conversation_id": conversation_id,
        "request_id": request_id,
    }

    # 发送消息：AI 私聊只回给发送者，小组讨论广播
    if target_user == "ai":
        await manager.send_to_user(
            session_id, user_info["user_id"],
            "CHAT_MESSAGE", message,
        )
    else:
        await manager.broadcast(session_id, "CHAT_MESSAGE", message)

    # 异步落库 + ACK
    asyncio.create_task(
        _save_message_and_ack(
            message, request_id=request_id,
            websocket=websocket, session_id=session_id,
            user_id=user_info["user_id"], manager=manager,
        )
    )

    # P1-7: 小组消息异步谬误检测（AI 私聊不检测）
    if target_user != "ai" and len(content) >= 20:
        asyncio.create_task(
            _run_fallacy_detection(
                session_id, user_info, content, manager, llm_provider,
            )
        )

    # 检测是否需要 AI 回复
    mentions = metadata.get("mentions", [])
    has_ai_mention = "@ai" in content.lower() or "ai" in mentions

    if has_ai_mention or target_user == "ai":
        # Risk 4: WS AI 请求限流 — 滑动窗口（5 次/60s/user）
        rate_ok = await _check_ai_rate_limit(user_info["user_id"])
        if not rate_ok:
            await manager.send_to_user(
                session_id, user_info["user_id"],
                "CHAT_MESSAGE", {
                    "message_id": str(uuid.uuid4()),
                    "session_id": session_id,
                    "sender": {"id": "system", "name": "系统", "role": "system"},
                    "content": "⚠️ 思考太快啦，请稍后再问（每分钟最多 5 次 AI 提问）",
                    "timing": {"absolute_time": now.isoformat(), "relative_minute": 0},
                    "metadata_info": {},
                    "created_at": now.isoformat(),
                    "recipient_id": user_info["user_id"],
                },
            )
            return

        # 注入支架 prompt（如果有 scaffold_info）
        scaffold_prompt = None
        scaffold_info = metadata.get("scaffold_info")
        if scaffold_info and scaffold_info.get("id"):
            scaffold_prompt = await _load_scaffold_prompt(
                scaffold_info["id"]
            )

        asyncio.create_task(
            _trigger_ai_reply(
                session_id=session_id,
                user_message=content,
                user_info=user_info,
                llm_provider=llm_provider,
                manager=manager,
                target_user=target_user,
                scaffold_prompt=scaffold_prompt,
                conversation_id=conversation_id,
            )
        )


async def _save_message_and_ack(
    message: dict,
    *,
    request_id: str | None,
    websocket: WebSocket,
    session_id: str,
    user_id: str,
    manager: ConnectionManager,
) -> None:
    """异步保存消息到数据库，并回复 CHAT_ACK。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.message import Message

        async with AsyncSessionLocal() as db:
            msg = Message(
                message_id=message["message_id"],
                session_id=message["session_id"],
                sender=message["sender"],
                content=message["content"],
                timing=message["timing"],
                metadata_info=message.get("metadata_info", {}),
                recipient_id=message.get("recipient_id"),
                conversation_id=message.get("conversation_id"),
            )
            db.add(msg)
            await db.commit()

        # ACK 成功
        if request_id:
            await manager.send_to_user(
                session_id, user_id,
                "CHAT_ACK",
                {
                    "request_id": request_id,
                    "message_id": message["message_id"],
                    "persisted": True,
                },
            )
    except Exception as e:
        logger.error("Failed to save message: %s", e)
        # ACK 失败
        if request_id:
            try:
                await manager.send_to_user(
                    session_id, user_id,
                    "CHAT_ACK",
                    {
                        "request_id": request_id,
                        "message_id": message["message_id"],
                        "persisted": False,
                        "error": str(e),
                    },
                )
            except Exception:
                pass


async def _load_scaffold_prompt(scaffold_id: str) -> str | None:
    """从数据库加载支架的 prompt_template。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.scaffold import Scaffold
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Scaffold.prompt_template).where(
                    Scaffold.scaffold_id == scaffold_id
                )
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.warning("Failed to load scaffold prompt: %s", e)
        return None



async def _trigger_ai_reply(
    *,
    session_id: str,
    user_message: str,
    user_info: dict,
    llm_provider: str,
    manager: ConnectionManager,
    target_user: str | None,
    scaffold_prompt: str | None = None,
    conversation_id: str | None = None,
) -> None:
    """触发 AI 回复 — 铁律 1+3：三明治上下文 + Redis 队列。"""
    from app.infra.ai_queue import get_queue
    from app.llm.prompts import MENTOR_PROMPT, ASSISTANT_PROMPT
    from app.llm.context_builder import build_sandwich_context, load_pinned_file_text

    is_private = target_user == "ai"
    system_prompt = MENTOR_PROMPT if is_private else ASSISTANT_PROMPT

    # 加载学生上传的文件（Pinned 区锚定）
    uploaded_file_text = await load_pinned_file_text(session_id)

    # ── 铁律 3：三明治上下文组装 ──
    messages = await build_sandwich_context(
        session_id=session_id,
        user_message=user_message,
        system_prompt=system_prompt,
        llm_provider=llm_provider,
        scaffold_prompt=scaffold_prompt,
        uploaded_file_text=uploaded_file_text,
        user_id=user_info.get("user_id"),
        conversation_id=conversation_id,
    )

    queue = get_queue()

    try:
        # ── 铁律 1：推入 Redis 队列，立即释放 WS 主循环 ──
        task_id = await queue.push_task(
            session_id=session_id,
            user_msg_id=str(uuid.uuid4()),
            user_message=user_message,
            user_info=user_info,
            llm_provider=llm_provider,
            messages=messages,
            is_private=is_private,
            conversation_id=conversation_id,
        )
        logger.info(
            "AI task %s queued for session=%s provider=%s",
            task_id, session_id, llm_provider,
        )

    except Exception as e:
        logger.exception("Failed to queue AI task: %s", e)
        try:
            await manager.broadcast(
                session_id, "AI_TYPING", {"is_typing": False},
            )
            error_data = {"message": f"AI 回复失败: {e}", "code": "AI_ERROR"}
            if is_private:
                await manager.send_to_user(
                    session_id, user_info["user_id"],
                    "ERROR", error_data,
                )
            else:
                await manager.broadcast(
                    session_id, "ERROR", error_data,
                )
        except Exception:
            pass


async def _run_fallacy_detection(
    session_id: str,
    user_info: dict,
    content: str,
    manager: ConnectionManager,
    llm_provider: str,
) -> None:
    """P1-7: 异步谬误检测包装器。"""
    try:
        from app.services.fallacy_detector import trigger_fallacy_intervention
        await trigger_fallacy_intervention(
            session_id, user_info, content, manager, llm_provider,
        )
    except Exception as e:
        logger.warning("Fallacy detection wrapper failed: %s", e)


async def _generate_conversation_title(
    user_message: str,
    ai_response: str,
    llm_provider: str,
) -> str | None:
    """用 LLM 为对话生成简短标题（≤15字）。"""
    try:
        from app.llm.factory import get_llm_client

        client = get_llm_client(llm_provider)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是一个标题生成器。根据对话内容生成一个简短的中文标题，"
                    "不超过15个字，不加引号和标点。直接输出标题文字。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"用户: {user_message[:200]}\n"
                    f"AI: {ai_response[:200]}"
                ),
            },
        ]

        title_parts: list[str] = []
        async for chunk in client.stream_chat(
            messages=messages, temperature=0.3
        ):
            title_parts.append(chunk)

        title = "".join(title_parts).strip()
        # 清理：去除引号等
        title = title.strip('"\'""''')
        return title[:50] if title else None

    except Exception as e:
        logger.warning("Failed to generate title: %s", e)
        return None


