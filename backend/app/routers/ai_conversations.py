"""AI 对话会话 REST API — 类似 ChatGPT 的对话管理。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.ai_conversation import AiConversation
from app.models.message import Message
from app.models.user import User

router = APIRouter(prefix="/ai-conversations", tags=["ai-conversations"])


# ── Schemas ──────────────────────────────────────

class ConversationOut(BaseModel):
    conversation_id: str
    title: str
    llm_provider: str | None = None
    message_count: int = 0
    created_at: str
    updated_at: str


class CreateConversationReq(BaseModel):
    title: str = Field(default="新对话", max_length=200)
    llm_provider: str | None = None


class UpdateTitleReq(BaseModel):
    title: str = Field(max_length=200)


# ── Endpoints ────────────────────────────────────

@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """列出当前用户的所有 AI 对话，按最近活跃倒序。"""
    result = await db.execute(
        select(AiConversation)
        .where(AiConversation.user_id == user.user_id)
        .order_by(AiConversation.updated_at.desc())
    )
    convos = result.scalars().all()
    return [
        ConversationOut(
            conversation_id=c.conversation_id,
            title=c.title,
            llm_provider=c.llm_provider,
            message_count=c.message_count,
            created_at=c.created_at.isoformat() if c.created_at else "",
            updated_at=c.updated_at.isoformat() if c.updated_at else "",
        )
        for c in convos
    ]


@router.post("", response_model=ConversationOut)
async def create_conversation(
    req: CreateConversationReq,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """创建新的 AI 对话会话。"""
    now = datetime.now(timezone.utc)
    convo = AiConversation(
        conversation_id=str(uuid.uuid4()),
        user_id=user.user_id,
        title=req.title,
        llm_provider=req.llm_provider,
        message_count=0,
        created_at=now,
        updated_at=now,
    )
    db.add(convo)
    await db.commit()
    await db.refresh(convo)

    return ConversationOut(
        conversation_id=convo.conversation_id,
        title=convo.title,
        llm_provider=convo.llm_provider,
        message_count=0,
        created_at=convo.created_at.isoformat(),
        updated_at=convo.updated_at.isoformat(),
    )


@router.get("/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取某对话的所有消息。"""
    # 验证对话属于当前用户
    convo = await db.execute(
        select(AiConversation).where(
            AiConversation.conversation_id == conversation_id,
            AiConversation.user_id == user.user_id,
        )
    )
    if not convo.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Conversation not found")

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    msgs = result.scalars().all()
    return [
        {
            "message_id": m.message_id,
            "session_id": m.session_id,
            "sender": m.sender if isinstance(m.sender, dict) else {},
            "content": m.content,
            "timing": m.timing if isinstance(m.timing, dict) else {},
            "metadata_info": (
                m.metadata_info if isinstance(m.metadata_info, dict)
                else {}
            ),
            "created_at": (
                m.created_at.isoformat() if m.created_at else None
            ),
            "recipient_id": m.recipient_id,
            "conversation_id": m.conversation_id,
        }
        for m in msgs
    ]


@router.patch("/{conversation_id}")
async def update_conversation_title(
    conversation_id: str,
    req: UpdateTitleReq,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """手动修改对话标题。"""
    result = await db.execute(
        update(AiConversation)
        .where(
            AiConversation.conversation_id == conversation_id,
            AiConversation.user_id == user.user_id,
        )
        .values(title=req.title)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.commit()
    return {"ok": True}


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """删除对话及其所有消息。"""
    # 验证归属
    convo = await db.execute(
        select(AiConversation).where(
            AiConversation.conversation_id == conversation_id,
            AiConversation.user_id == user.user_id,
        )
    )
    if not convo.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Conversation not found")

    # 删除消息
    await db.execute(
        delete(Message).where(
            Message.conversation_id == conversation_id
        )
    )
    # 删除对话
    await db.execute(
        delete(AiConversation).where(
            AiConversation.conversation_id == conversation_id
        )
    )
    await db.commit()
    return {"ok": True}


@router.post("/{conversation_id}/summarize")
async def summarize_conversation(
    conversation_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """为指定对话生成一句话摘要（跨窗口记忆用）。

    前端在用户切换对话时调用此接口。
    若对话消息 < 4 条或已有摘要，则跳过。
    """
    # 验证归属
    convo = await db.execute(
        select(AiConversation).where(
            AiConversation.conversation_id == conversation_id,
            AiConversation.user_id == user.user_id,
        )
    )
    if not convo.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Conversation not found")

    import asyncio
    from app.services.summary_service import generate_conversation_summary

    # 异步执行，不阻塞返回
    asyncio.create_task(
        generate_conversation_summary(
            conversation_id=conversation_id,
            user_id=str(user.user_id),
            db=db,
        )
    )
    return {"ok": True, "message": "摘要生成已排队"}

