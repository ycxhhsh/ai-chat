"""学习空间设计摘要生成。"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.factory import get_llm_client
from app.llm.prompts import LEARNING_SPACE_DESIGN_SUMMARY_PROMPT
from app.services.learning_space_design_service import build_report


async def generate_learning_space_summary(
    db: AsyncSession,
    session_id: str,
    llm_provider: str = "deepseek",
) -> str:
    report = await build_report(db, session_id, viewer_role="teacher")
    client = get_llm_client(llm_provider)
    summary = await client.chat(
        messages=[
            {"role": "system", "content": LEARNING_SPACE_DESIGN_SUMMARY_PROMPT},
            {"role": "user", "content": str(report)},
        ],
        temperature=0.4,
    )
    return summary.strip()
