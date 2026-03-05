"""逻辑谬误检测服务 — 双漏斗降本设计（白皮书 §2）。

漏斗结构：
1. 前置小模型（极速，成本极低）做 True/False 判定
2. 仅当判定为 True 时，才唤醒主力大模型生成温和追问

LLM 选择策略：
- 第一漏斗（快筛）：使用 deepseek（小规模模型 / Flash 模式）
- 第二漏斗（分析+介入）：使用 deepseek（主力模型）
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ── 第一漏斗的快速筛选 Prompt ──
FAST_SCREEN_PROMPT = """\
你是一个逻辑谬误快速检测器。判断以下学生发言是否包含明显的逻辑谬误。

常见谬误类型：滑坡谬误、偷换概念、人身攻击、稻草人谬误、循环论证、以偏概全。

只回答 TRUE 或 FALSE：
- TRUE = 发现明显逻辑谬误
- FALSE = 未发现或不确定

严格只输出 TRUE 或 FALSE，不要输出其他内容。
"""


async def _fast_screen(content: str, llm_provider: str = "deepseek") -> bool:
    """第一漏斗：极速小模型做 True/False 判定。"""
    if len(content.strip()) < 20:
        return False

    try:
        from app.llm.factory import get_llm_client

        client = get_llm_client(llm_provider)
        messages = [
            {"role": "system", "content": FAST_SCREEN_PROMPT},
            {"role": "user", "content": content},
        ]

        response = ""
        async for chunk in client.stream_chat(messages=messages):
            response += chunk
            # 快速截断：只需要 TRUE/FALSE
            if len(response) > 20:
                break

        return response.strip().upper().startswith("TRUE")
    except Exception as e:
        logger.warning("Fast screen failed: %s", e)
        return False


async def detect_fallacy(content: str, llm_provider: str = "deepseek") -> dict | None:
    """分析消息内容是否包含逻辑谬误。

    Returns:
        None 表示无谬误（PASS），dict 包含谬误信息。
    """
    if len(content.strip()) < 20:
        return None

    try:
        from app.llm.factory import get_llm_client
        from app.llm.prompts import FALLACY_DETECTION_PROMPT

        client = get_llm_client(llm_provider)
        messages = [
            {"role": "system", "content": FALLACY_DETECTION_PROMPT},
            {"role": "user", "content": content},
        ]

        full_response = ""
        async for chunk in client.stream_chat(messages=messages):
            full_response += chunk

        full_response = full_response.strip()

        if full_response.upper() == "PASS":
            return None

        try:
            return json.loads(full_response)
        except json.JSONDecodeError:
            return {"raw_analysis": full_response}

    except Exception as e:
        logger.warning("Fallacy detection failed: %s", e)
        return None


async def trigger_fallacy_intervention(
    session_id: str,
    user_info: dict,
    content: str,
    manager: Any,
    llm_provider: str = "deepseek",
) -> None:
    """双漏斗静默 AI 巡检 — 检出谬误时以温和追问方式介入。

    流程：
    1. 第一漏斗：快速 True/False 筛选（低成本）
    2. 第二漏斗：仅 True 时唤醒主力模型详细分析
    3. 生成温和追问并广播
    """
    try:
        # ── 第一漏斗：快筛 ──
        has_fallacy = await _fast_screen(content, llm_provider)
        if not has_fallacy:
            logger.debug("Fast screen PASS for session=%s", session_id)
            return

        logger.info(
            "Fast screen TRUE for session=%s user=%s, invoking main model",
            session_id, user_info.get("user_id"),
        )

        # ── 第二漏斗：主力模型详细分析 ──
        result = await detect_fallacy(content, llm_provider)
        if not result:
            return

        logger.info(
            "Fallacy confirmed in session=%s: %s",
            session_id, result,
        )

        # ── 生成温和追问 ──
        from app.llm.factory import get_llm_client

        client = get_llm_client(llm_provider)

        if isinstance(result, dict) and "raw_analysis" in result:
            analysis = result["raw_analysis"]
        else:
            analysis = json.dumps(result, ensure_ascii=False)

        prompt = (
            "你是一个善于引导思考的 AI 助教。"
            "刚才检测到学生的发言中可能存在逻辑问题。\n"
            f"分析结果：{analysis}\n\n"
            "请用温和的追问方式（不直接指出错误），引导学生重新审视自己的论点。"
            "回复要简短（2-3句话），以问题结尾。"
            "不要提及你进行了谬误检测。"
        )

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": content},
        ]

        full_reply = ""
        async for chunk in client.stream_chat(messages=messages):
            full_reply += chunk

        if not full_reply.strip():
            return

        # 构造 AI 消息并发送
        ai_msg = {
            "message_id": str(uuid.uuid4()),
            "session_id": session_id,
            "sender": {"id": "ai", "name": "AI 助教", "role": "ai"},
            "content": full_reply.strip(),
            "timing": {
                "absolute_time": datetime.now(timezone.utc).isoformat(),
                "relative_minute": 0,
            },
            "metadata_info": {
                "is_fallacy_intervention": True,
                "llm_provider": llm_provider,
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "recipient_id": None,
        }

        await manager.broadcast(session_id, "CHAT_MESSAGE", ai_msg)

        # 落库
        from app.db.session import AsyncSessionLocal
        from app.models.message import Message

        async with AsyncSessionLocal() as db:
            db.add(Message(
                message_id=ai_msg["message_id"],
                session_id=session_id,
                sender=ai_msg["sender"],
                content=ai_msg["content"],
                timing=ai_msg["timing"],
                metadata_info=ai_msg["metadata_info"],
                recipient_id=None,
            ))
            await db.commit()

    except Exception as e:
        logger.warning("Fallacy intervention failed: %s", e)
