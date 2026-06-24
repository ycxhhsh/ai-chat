"""Build and persist canonical AI reply messages."""
from __future__ import annotations

from datetime import datetime, timezone

from app.db.session import AsyncSessionLocal
from app.models.message import Message


def build_ai_message(
    *,
    message_id: str,
    session_id: str,
    content: str,
    llm_provider: str,
    user_info: dict,
    is_private: bool,
    conversation_id: str | None,
) -> dict:
    """Return the single message shape used by storage and delivery."""
    now = datetime.now(timezone.utc)
    return {
        "message_id": message_id,
        "session_id": session_id,
        "sender": {"id": "ai", "name": "AI 助教", "role": "ai"},
        "content": content,
        "timing": {
            "absolute_time": now.isoformat(),
            "relative_minute": 0,
        },
        "metadata_info": {"llm_provider": llm_provider},
        "created_at": now.isoformat(),
        "recipient_id": user_info.get("user_id") if is_private else None,
        "conversation_id": conversation_id,
    }


async def persist_ai_message(message: dict) -> None:
    """Commit an AI reply before any best-effort realtime delivery."""
    async with AsyncSessionLocal() as db:
        db.add(Message(
            message_id=message["message_id"],
            session_id=message["session_id"],
            sender=message["sender"],
            content=message["content"],
            timing=message["timing"],
            metadata_info=message.get("metadata_info", {}),
            recipient_id=message.get("recipient_id"),
            conversation_id=message.get("conversation_id"),
        ))
        await db.commit()
