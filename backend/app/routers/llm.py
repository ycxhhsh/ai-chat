"""LLM Provider 查询路由。"""
from __future__ import annotations

from fastapi import APIRouter

from app.llm.factory import get_available_providers

router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/providers")
async def list_providers():
    """返回当前已配置的可用 LLM Provider 列表。"""
    return get_available_providers()
