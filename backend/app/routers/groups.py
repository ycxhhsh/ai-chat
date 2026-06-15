"""小组管理路由。"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.group import Group, GroupMember, GroupRoleObjection
from app.models.user import User
from app.services.group_roles import (
    COLLABORATION_ROLES,
    assign_role_to_member,
    role_payload,
)

router = APIRouter(prefix="/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str


class GroupJoin(BaseModel):
    invite_code: str


class RoleObjectionCreate(BaseModel):
    reason: str
    note: str | None = None


class GroupResponse(BaseModel):
    id: str
    name: str
    invite_code: str
    created_by: str
    created_at: str
    current_stage: str

    class Config:
        from_attributes = True


async def _get_user_avoided_roles(db: AsyncSession, user_id: str) -> list[str]:
    result = await db.execute(
        select(GroupRoleObjection.current_role).where(
            GroupRoleObjection.user_id == user_id,
            GroupRoleObjection.current_role.in_(list(COLLABORATION_ROLES)),
        )
    )
    return [row[0] for row in result.all()]


@router.post("", response_model=GroupResponse)
async def create_group(
    body: GroupCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    invite_code = uuid.uuid4().hex[:8].upper()
    group_id = f"group_{uuid.uuid4().hex[:8]}"
    group = Group(
        id=group_id,
        name=body.name,
        invite_code=invite_code,
        created_by=str(user.user_id),
    )
    db.add(group)

    member = GroupMember(
        group_id=group_id,
        user_id=str(user.user_id),
        role="admin",
    )
    avoided_roles = await _get_user_avoided_roles(db, str(user.user_id))
    assign_role_to_member(member, [], "system", avoided_roles)
    db.add(member)
    await db.commit()
    await db.refresh(group)

    return GroupResponse(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        created_by=group.created_by,
        created_at=group.created_at.isoformat(),
        current_stage=group.current_stage,
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
    member = existing.scalar_one_or_none()
    if member:
        if not member.collaboration_role:
            roles = await db.execute(
                select(GroupMember.collaboration_role).where(
                    GroupMember.group_id == group.id,
                    GroupMember.user_id != str(user.user_id),
                )
            )
            avoided_roles = await _get_user_avoided_roles(db, str(user.user_id))
            assign_role_to_member(
                member,
                [row[0] for row in roles.all()],
                "system",
                avoided_roles,
            )
            db.add(member)
            await db.commit()
        return {"status": "already_joined", "group_id": group.id}

    member = GroupMember(
        group_id=group.id,
        user_id=str(user.user_id),
        role="member",
    )
    roles = await db.execute(
        select(GroupMember.collaboration_role).where(GroupMember.group_id == group.id)
    )
    avoided_roles = await _get_user_avoided_roles(db, str(user.user_id))
    assign_role_to_member(
        member,
        [row[0] for row in roles.all()],
        "system",
        avoided_roles,
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
            current_stage=g.current_stage,
        )
        for g in groups
    ]


@router.get("/{group_id}/role")
async def get_my_group_role(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """获取当前学生在小组中的协作角色。"""
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == str(user.user_id),
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="非小组成员")

    if not member.collaboration_role:
        roles = await db.execute(
            select(GroupMember.collaboration_role).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id != str(user.user_id),
            )
        )
        avoided_roles = await _get_user_avoided_roles(db, str(user.user_id))
        assign_role_to_member(
            member,
            [row[0] for row in roles.all()],
            "system",
            avoided_roles,
        )
        db.add(member)
        await db.commit()
        await db.refresh(member)

    objection = await db.execute(
        select(GroupRoleObjection)
        .where(
            GroupRoleObjection.group_id == group_id,
            GroupRoleObjection.user_id == str(user.user_id),
            GroupRoleObjection.status == "pending",
        )
        .order_by(GroupRoleObjection.created_at.desc())
    )
    pending = objection.scalars().first()
    payload = role_payload(member.collaboration_role)
    return {
        **payload,
        "assigned_by": member.role_assigned_by or "system",
        "assigned_at": member.role_assigned_at.isoformat() if member.role_assigned_at else None,
        "pending_objection": (
            {
                "id": pending.id,
                "reason": pending.reason,
                "note": pending.note,
                "status": pending.status,
                "created_at": pending.created_at.isoformat() if pending.created_at else "",
            }
            if pending
            else None
        ),
    }


@router.post("/{group_id}/role-objections")
async def create_role_objection(
    group_id: str,
    body: RoleObjectionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生提交协作角色异议。"""
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == str(user.user_id),
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="非小组成员")
    if not member.collaboration_role:
        roles = await db.execute(
            select(GroupMember.collaboration_role).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id != str(user.user_id),
            )
        )
        avoided_roles = await _get_user_avoided_roles(db, str(user.user_id))
        assign_role_to_member(
            member,
            [row[0] for row in roles.all()],
            "system",
            avoided_roles,
        )
        db.add(member)

    existing = await db.execute(
        select(GroupRoleObjection).where(
            GroupRoleObjection.group_id == group_id,
            GroupRoleObjection.user_id == str(user.user_id),
            GroupRoleObjection.status == "pending",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="已有待处理的角色异议")

    objection = GroupRoleObjection(
        group_id=group_id,
        user_id=str(user.user_id),
        current_role=member.collaboration_role or "",
        reason=body.reason.strip(),
        note=body.note.strip() if body.note else None,
        status="pending",
    )
    db.add(objection)
    await db.commit()
    await db.refresh(objection)
    return {
        "id": objection.id,
        "group_id": objection.group_id,
        "user_id": objection.user_id,
        "current_role": objection.current_role,
        "reason": objection.reason,
        "note": objection.note,
        "status": objection.status,
        "created_at": objection.created_at.isoformat() if objection.created_at else "",
    }


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


class GroupRename(BaseModel):
    name: str


@router.patch("/{group_id}", response_model=GroupResponse)
async def rename_group(
    group_id: str,
    body: GroupRename,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """重命名小组（组内成员可操作）。"""
    # 验证用户是组内成员
    member = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == str(user.user_id),
        )
    )
    if not member.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="非小组成员")

    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="小组不存在")

    group.name = body.name.strip()
    db.add(group)
    await db.commit()
    await db.refresh(group)

    return GroupResponse(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        created_by=group.created_by,
        created_at=group.created_at.isoformat(),
        current_stage=group.current_stage,
    )


class MemberResponse(BaseModel):
    user_id: str
    name: str
    role: str


@router.get("/{group_id}/members", response_model=list[MemberResponse])
async def list_group_members(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """获取小组成员列表（组内成员可访问）。"""
    # 验证调用者是组内成员
    caller = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == str(user.user_id),
        )
    )
    if not caller.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="非小组成员")

    result = await db.execute(
        select(GroupMember, User)
        .join(User, User.user_id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
    )
    rows = result.all()
    return [
        MemberResponse(
            user_id=gm.user_id,
            name=u.name,
            role=gm.role,
        )
        for gm, u in rows
    ]


class StageUpdateBody(BaseModel):
    stage: str  # Empathy | Define | Ideate | Prototype | Test


VALID_STAGES = {"Empathy", "Define", "Ideate", "Prototype", "Test"}


@router.post("/{group_id}/stage")
async def teacher_push_stage(
    group_id: str,
    body: StageUpdateBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """教师端：将 EDIPT 阶段广播给指定小组所有在线学生，并持久化到小组记录。"""
    if user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="仅教师可操作")
    if body.stage not in VALID_STAGES:
        raise HTTPException(status_code=422, detail=f"无效阶段，合法值: {VALID_STAGES}")

    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="小组不存在")

    # 持久化当前阶段
    group.current_stage = body.stage
    db.add(group)
    await db.commit()

    # 通过 WS Manager 广播给所有在线学生
    try:
        from app.websockets.manager import manager
        await manager.broadcast(group_id, "STAGE_UPDATE", {
            "stage": body.stage,
            "group_id": group_id,
            "pushed_by": str(user.user_id),
        })
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Stage broadcast failed: %s", e)

    return {"ok": True, "group_id": group_id, "stage": body.stage}


@router.post("/stage/all")
async def teacher_push_stage_all(
    body: StageUpdateBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """教师端：一键将所有小组的 EDIPT 阶段推进，并全部广播。"""
    if user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="仅教师可操作")
    if body.stage not in VALID_STAGES:
        raise HTTPException(status_code=422, detail=f"无效阶段，合法值: {VALID_STAGES}")

    # 修改全体记录
    result = await db.execute(select(Group))
    groups = result.scalars().all()
    for g in groups:
        g.current_stage = body.stage
        db.add(g)

    await db.commit()

    # 向所有正在工作的 websocket channel 广播
    try:
        from app.websockets.manager import manager
        for g in groups:
            await manager.broadcast(g.id, "STAGE_UPDATE", {
                "stage": body.stage,
                "group_id": g.id,
                "pushed_by": str(user.user_id),
            })
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Stage broadcast all failed: %s", e)

    return {"ok": True, "stage": body.stage, "updated_count": len(groups)}

