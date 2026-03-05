"""小组管理路由。"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.group import Group, GroupMember
from app.models.user import User

router = APIRouter(prefix="/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str


class GroupJoin(BaseModel):
    invite_code: str


class GroupResponse(BaseModel):
    id: str
    name: str
    invite_code: str
    created_by: str
    created_at: str

    class Config:
        from_attributes = True


@router.post("", response_model=GroupResponse)
async def create_group(
    body: GroupCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    invite_code = uuid.uuid4().hex[:8].upper()
    group = Group(
        name=body.name,
        invite_code=invite_code,
        created_by=str(user.user_id),
    )
    db.add(group)
    await db.flush()  # 让 default lambda 生成 group.id

    member = GroupMember(
        group_id=group.id,
        user_id=str(user.user_id),
        role="admin",
    )
    db.add(member)
    await db.commit()
    await db.refresh(group)

    return GroupResponse(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        created_by=group.created_by,
        created_at=group.created_at.isoformat(),
    )


@router.post("/join")
async def join_group(
    body: GroupJoin,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    result = await db.execute(
        select(Group).where(Group.invite_code == body.invite_code.upper())
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="邀请码无效")

    # 检查是否已加入
    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group.id,
            GroupMember.user_id == str(user.user_id),
        )
    )
    if existing.scalar_one_or_none():
        return {"status": "already_joined", "group_id": group.id}

    member = GroupMember(
        group_id=group.id,
        user_id=str(user.user_id),
        role="member",
    )
    db.add(member)
    await db.commit()
    return {"status": "joined", "group_id": group.id}


@router.get("/my", response_model=list[GroupResponse])
async def list_my_groups(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    result = await db.execute(
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == str(user.user_id))
    )
    groups = result.scalars().all()
    return [
        GroupResponse(
            id=g.id,
            name=g.name,
            invite_code=g.invite_code,
            created_by=g.created_by,
            created_at=g.created_at.isoformat(),
        )
        for g in groups
    ]


@router.delete("/{group_id}")
async def delete_group(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """删除小组（仅创建人可操作）。"""
    from sqlalchemy import delete as sql_delete

    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="小组不存在")
    if group.created_by != str(user.user_id):
        raise HTTPException(status_code=403, detail="只有小组创建人才能删除")

    # 先删成员再删小组
    await db.execute(
        sql_delete(GroupMember).where(GroupMember.group_id == group_id)
    )
    await db.execute(
        sql_delete(Group).where(Group.id == group_id)
    )
    await db.commit()
    return {"status": "deleted", "group_id": group_id}

