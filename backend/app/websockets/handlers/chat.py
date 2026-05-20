"""Chat WS 事件处理。"""
from __future__ import annotations

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
    manager.track_task(
        _save_message_and_ack(
            message, request_id=request_id,
            websocket=websocket, session_id=session_id,
            user_id=user_info["user_id"], manager=manager,
        )
    )

    # P1-7: 小组消息异步谬误检测（AI 私聊不检测）
    if target_user != "ai" and len(content) >= 20:
        manager.track_task(
            _run_fallacy_detection(
                session_id, user_info, content, manager, llm_provider,
            )
        )

    # 检测是否需要 AI 回复
    mentions = metadata.get("mentions", [])
    has_ai_mention = (
        "@ai" in content.lower()
        or "ai" in mentions
        or "@ai助手" in content.lower()
        or "ai助手" in mentions
    )

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

        manager.track_task(
            _trigger_ai_reply_with_stage(
                session_id=session_id,
                user_message=content,
                user_info=user_info,
                llm_provider=llm_provider,
                manager=manager,
                target_user=target_user,
                scaffold_prompt=scaffold_prompt,
                conversation_id=conversation_id,
                quoted_text=metadata.get("quoted_text"),
                is_deep_thinking=data.get("is_deep_thinking", False),
                enable_search=data.get("enable_search", False),
            )
        )

async def _trigger_ai_reply_with_stage(session_id: str, **kwargs) -> None:
    current_stage = "Empathy"
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.group import Group
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            stage_res = await db.execute(select(Group.current_stage).where(Group.id == session_id))
            stage = stage_res.scalar_one_or_none()
            if stage:
                current_stage = stage
    except Exception:
        pass

    kwargs["session_id"] = session_id
    kwargs["current_stage"] = current_stage
    await _trigger_ai_reply(**kwargs)


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
        from app.models.group import Group
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            # fetch current stage
            stage_res = await db.execute(select(Group.current_stage).where(Group.id == session_id))
            current_stage = stage_res.scalar_one_or_none()

            msg = Message(
                message_id=message["message_id"],
                session_id=message["session_id"],
                sender=message["sender"],
                content=message["content"],
                timing=message["timing"],
                metadata_info=message.get("metadata_info", {}),
                recipient_id=message.get("recipient_id"),
                conversation_id=message.get("conversation_id"),
                edipt_stage=current_stage,
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
    quoted_text: str | None = None,
    is_deep_thinking: bool = False,
    enable_search: bool = False,
    current_stage: str = "Empathy",
) -> None:
    """触发 AI 回复 — 铁律 1+3：三明治上下文 + Redis 队列。"""
    from app.infra.ai_queue import get_queue
    from app.llm.prompts import MENTOR_PROMPT, ASSISTANT_PROMPT, DEEP_THINK_INSTRUCTION
    from app.llm.context_builder import build_sandwich_context, load_pinned_file_text

    is_private = target_user == "ai"
    system_prompt = MENTOR_PROMPT if is_private else ASSISTANT_PROMPT

    # P2: 深度思考模式 — 追加 CoT 指令
    if is_deep_thinking:
        system_prompt += DEEP_THINK_INSTRUCTION

    # 追问引用：将被引用的文本作为上下文注入用户消息
    effective_message = user_message
    if quoted_text:
        effective_message = (
            f"【追问引用】学生选中了你之前回答中的以下片段进行追问，"
            f"请重点审查并深入展开这部分内容：\n"
            f"\"\"\"\n{quoted_text}\n\"\"\"\n\n"
            f"学生的追问：{user_message}"
        )

    # 加载学生上传的文件（Pinned 区锚定）
    uploaded_file_text = await load_pinned_file_text(session_id)

    # ── 铁律 3：三明治上下文组装 ──
    messages = await build_sandwich_context(
        session_id=session_id,
        user_message=effective_message,
        system_prompt=system_prompt,
        llm_provider=llm_provider,
        scaffold_prompt=scaffold_prompt,
        uploaded_file_text=uploaded_file_text,
        user_id=user_info.get("user_id"),
        conversation_id=conversation_id,
        current_stage=current_stage,
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
            enable_search=enable_search,
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

async def handle_stage_update(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理 STAGE_UPDATE 事件（教师修改进度）。"""
    user_info = manager.get_user_info(websocket)
    if not user_info or user_info.get("role") != "teacher":
        await manager.send_error(websocket, "Permission denied")
        return

    new_stage = data.get("stage")
    if not new_stage:
        await manager.send_error(websocket, "Stage is missing")
        return

    # 广播进度信息
    await manager.broadcast(
        session_id, "STAGE_UPDATE", {"stage": new_stage, "updated_by": user_info["user_id"]}
    )

    # 异步落库组进度
    manager.track_task(_save_group_stage(session_id, new_stage))

async def _save_group_stage(group_id: str, stage: str) -> None:
    """保存进度到数据库。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.group import Group
        from sqlalchemy import update
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(Group).where(Group.id == group_id).values(current_stage=stage)
            )
            await db.commit()
    except Exception as e:
        logger.error("Failed to update group stage: %s", e)


async def handle_design_drawing(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理发起画图请求。"""
    user_info = manager.get_user_info(websocket)
    if not user_info:
        await manager.send_error(websocket, "Not authenticated")
        return
    api_provider = data.get("api_provider", "deepseek")
    custom_prompt = data.get("custom_prompt")

    from app.infra.ai_queue import get_queue
    from app.llm.context_builder import _load_recent_messages

    queue = get_queue()

    try:
        # Load recent group messages to extract consensus
        messages = await _load_recent_messages(session_id, limit=20)
        formatted_msgs = []
        for msg in messages:
            sender = msg.sender if isinstance(msg.sender, dict) else {}
            name = sender.get("name", "Unknown")
            formatted_msgs.append({"role": "user", "content": f"[{name}]: {msg.content}"})

        # Push to REDIS
        task_id = await queue.push_drawing_task(
            session_id=session_id,
            user_info=user_info,
            messages=formatted_msgs,
            api_provider=api_provider,
            custom_prompt=custom_prompt,
        )
        logger.info("Design drawing task %s queued for session=%s", task_id, session_id)
    except Exception as e:
        logger.exception("Failed to queue drawing task: %s", e)
        await manager.send_error(websocket, f"Failed to start drawing: {e}", code="DRAWING_ERROR")


async def handle_prepare_drawing(
    websocket: WebSocket,
    session_id: str,
    data: dict[str, Any],
    manager: ConnectionManager,
) -> None:
    """处理预发画图请求（提炼 prompt）。"""
    user_info = manager.get_user_info(websocket)
    if not user_info:
        await manager.send_error(websocket, "Not authenticated")
        return
    llm_provider = data.get("llm_provider", "deepseek")

    from app.llm.context_builder import _load_recent_messages
    from app.llm.factory import get_llm_client

    try:
        messages = await _load_recent_messages(session_id, limit=20)
        chat_context = "\\n".join([
            f"[{msg.sender.get('name', 'Unknown') if isinstance(msg.sender, dict) else 'Unknown'}]: {msg.content}"
            for msg in messages
        ])

        system_prompt = (
            "你是一个专业的绘画提示词专家。请根据以下小组成员的对话内容，"
            "提取出他们讨论的设计要素（如对象、材质、颜色、风格、背景等），"
            "并整合成一段连贯、详细的画面描述提示词（不超过100字）。直接输出提示词，不需要任何多余解释。"
        )

        llm_msgs = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"小组对话:\\n{chat_context}"}
        ]

        client = get_llm_client(llm_provider)
        prompt_parts: list[str] = []
        async for chunk in client.stream_chat(messages=llm_msgs, temperature=0.7):
            prompt_parts.append(chunk)

        result_prompt = "".join(prompt_parts).strip()

        await manager.send_to_user(
            session_id, user_info["user_id"],
            "DRAWING_PROMPT_READY",
            {"prompt": result_prompt}
        )

    except Exception as e:
        logger.exception("Failed to prepare drawing prompt: %s", e)
        await manager.send_error(websocket, f"Failed to prepare drawing: {e}", code="DRAWING_PREPARE_ERROR")
