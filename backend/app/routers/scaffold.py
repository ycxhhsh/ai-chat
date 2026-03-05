"""支架 CRUD 路由。"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_teacher
from app.models.scaffold import Scaffold
from app.models.user import User

router = APIRouter(prefix="/scaffolds", tags=["scaffolds"])


class ScaffoldCreate(BaseModel):
    display_name: str
    prompt_template: str
    is_active: bool = True
    sort_order: int = 0


class ScaffoldUpdate(BaseModel):
    display_name: str | None = None
    prompt_template: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ScaffoldResponse(BaseModel):
    scaffold_id: str
    display_name: str
    prompt_template: str
    is_active: bool
    sort_order: int

    class Config:
        from_attributes = True


@router.get("", response_model=list[ScaffoldResponse])
async def list_scaffolds(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Scaffold).order_by(Scaffold.sort_order)
    )
    scaffolds = result.scalars().all()
    return [
        ScaffoldResponse(
            scaffold_id=str(s.scaffold_id),
            display_name=s.display_name,
            prompt_template=s.prompt_template,
            is_active=s.is_active,
            sort_order=s.sort_order,
        )
        for s in scaffolds
    ]


@router.post("", response_model=ScaffoldResponse)
async def create_scaffold(
    body: ScaffoldCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    scaffold = Scaffold(
        display_name=body.display_name,
        prompt_template=body.prompt_template,
        is_active=body.is_active,
        sort_order=body.sort_order,
    )
    db.add(scaffold)
    await db.commit()
    await db.refresh(scaffold)
    return ScaffoldResponse(
        scaffold_id=str(scaffold.scaffold_id),
        display_name=scaffold.display_name,
        prompt_template=scaffold.prompt_template,
        is_active=scaffold.is_active,
        sort_order=scaffold.sort_order,
    )


@router.patch("/{scaffold_id}", response_model=ScaffoldResponse)
async def update_scaffold(
    scaffold_id: UUID,
    body: ScaffoldUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    result = await db.execute(
        select(Scaffold).where(Scaffold.scaffold_id == str(scaffold_id))
    )
    scaffold = result.scalar_one_or_none()
    if not scaffold:
        raise HTTPException(status_code=404, detail="Scaffold not found")

    if body.display_name is not None:
        scaffold.display_name = body.display_name
    if body.prompt_template is not None:
        scaffold.prompt_template = body.prompt_template
    if body.is_active is not None:
        scaffold.is_active = body.is_active
    if body.sort_order is not None:
        scaffold.sort_order = body.sort_order

    await db.commit()
    await db.refresh(scaffold)
    return ScaffoldResponse(
        scaffold_id=str(scaffold.scaffold_id),
        display_name=scaffold.display_name,
        prompt_template=scaffold.prompt_template,
        is_active=scaffold.is_active,
        sort_order=scaffold.sort_order,
    )
