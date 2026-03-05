"""思维导图 REST 路由。"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, get_current_user
from app.models.mindmap import MindMap
from app.models.user import User

router = APIRouter(prefix="/mindmaps", tags=["mindmaps"])


@router.get("/{map_key:path}")
async def get_mindmap(
    map_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
):
    """获取指定 map_key 的最新思维导图。"""
    result = await db.execute(
        select(MindMap)
        .where(MindMap.map_key == map_key)
        .order_by(MindMap.updated_at.desc())
        .limit(1)
    )
    mindmap = result.scalar_one_or_none()
    if not mindmap:
        return {"nodes": [], "edges": [], "version": 0, "map_key": map_key}

    return {
        "id": mindmap.id,
        "session_id": mindmap.session_id,
        "map_key": mindmap.map_key,
        "nodes": mindmap.nodes,
        "edges": mindmap.edges,
        "version": mindmap.version,
    }
