"""LLM Provider 查询路由。"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.dependencies import require_teacher
from app.llm.factory import get_available_providers, _PROVIDER_REGISTRY
from app.models.user import User

router = APIRouter(prefix="/llm", tags=["llm"])

# P1: 默认 Provider 存储（简单方案用内存）
_default_store: dict[str, str] = {"provider": "deepseek"}


class DefaultProviderBody(BaseModel):
    provider: str


@router.get("/providers")
async def list_providers():
    """返回当前已配置的可用 LLM Provider 列表。"""
    return get_available_providers()


@router.put("/default-provider")
async def set_default_provider(
    body: DefaultProviderBody,
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师设置默认 LLM Provider。"""
    if body.provider not in _PROVIDER_REGISTRY:
        raise HTTPException(400, f"Unknown provider: {body.provider}")
    _default_store["provider"] = body.provider
    return {"default_provider": body.provider}


@router.get("/default-provider")
async def get_default_provider():
    """获取默认 LLM Provider。"""
    return {"default_provider": _default_store.get("provider", "deepseek")}

