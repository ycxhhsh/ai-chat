"""Jobs & Notifications API 路由 — DeepSearch + 站内通知。"""
from __future__ import annotations

import asyncio
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update as sa_update, desc, func

from app.core.dependencies import get_db, get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["jobs"])


# ── Schemas ──

class CreateJobRequest(BaseModel):
    type: str = "deep_search"
    title: str
    input_data: dict | None = None
    llm_provider: str = "deepseek"
    session_id: str | None = None


class JobResponse(BaseModel):
    id: str
    type: str
    status: str
    title: str
    progress: int
    input_data: dict | None
    result: dict | None
    error_message: str | None
    created_at: str
    updated_at: str


class NotificationResponse(BaseModel):
    id: str
    type: str
    title: str
    content: str | None
    is_read: bool
    job_id: str | None
    created_at: str


# ── Job 端点 ──

@router.post("/jobs", response_model=JobResponse)
async def create_job(
    req: CreateJobRequest,
    db=Depends(get_db),
    user: User = Depends(get_current_user),
):
    """创建异步后台任务（DeepSearch）。"""
    from app.models.job import Job

    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        user_id=user.user_id,
        session_id=req.session_id,
        type=req.type,
        status="pending",
        title=req.title,
        input_data=req.input_data,
        progress=0,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # 异步启动 DeepSearch
    if req.type == "deep_search" and req.input_data:
        topic = req.input_data.get("topic", req.title)

        async def _run_in_background():
            from app.db.session import AsyncSessionLocal
            async with AsyncSessionLocal() as sess:
                await sess.execute(
                    sa_update(Job).where(Job.id == job_id).values(status="running")
                )
                await sess.commit()

            from app.services.deep_search_worker import run_deep_search
            await run_deep_search(
                topic=topic,
                job_id=job_id,
                user_id=str(user.user_id),
                session_id=req.session_id,
                llm_provider=req.llm_provider,
            )

        asyncio.create_task(_run_in_background())

    return _job_to_response(job)


@router.get("/jobs", response_model=list[JobResponse])
async def list_jobs(
    db=Depends(get_db),
    user: User = Depends(get_current_user),
):
    """查看我的任务列表。"""
    from app.models.job import Job

    result = await db.execute(
        select(Job)
        .where(Job.user_id == user.user_id)
        .order_by(desc(Job.created_at))
        .limit(20)
    )
    jobs = result.scalars().all()
    return [_job_to_response(j) for j in jobs]


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    db=Depends(get_db),
    user: User = Depends(get_current_user),
):
    """查看任务详情/结果。"""
    from app.models.job import Job

    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.user_id == user.user_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


# ── Notification 端点 ──

@router.get("/notifications", response_model=list[NotificationResponse])
async def list_notifications(
    db=Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取通知列表。"""
    from app.models.notification import Notification

    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user.user_id)
        .order_by(desc(Notification.created_at))
        .limit(50)
    )
    notifs = result.scalars().all()
    return [_notif_to_response(n) for n in notifs]


@router.get("/notifications/unread-count")
async def unread_count(
    db=Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取未读通知数量。"""
    from app.models.notification import Notification

    result = await db.execute(
        select(func.count()).where(
            Notification.user_id == user.user_id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    count = result.scalar() or 0
    return {"unread_count": count}


@router.patch("/notifications/{notif_id}/read")
async def mark_read(
    notif_id: str,
    db=Depends(get_db),
    user: User = Depends(get_current_user),
):
    """标记通知已读。"""
    from app.models.notification import Notification

    await db.execute(
        sa_update(Notification)
        .where(Notification.id == notif_id, Notification.user_id == user.user_id)
        .values(is_read=True)
    )
    await db.commit()
    return {"ok": True}


@router.patch("/notifications/read-all")
async def mark_all_read(
    db=Depends(get_db),
    user: User = Depends(get_current_user),
):
    """全部标记已读。"""
    from app.models.notification import Notification

    await db.execute(
        sa_update(Notification)
        .where(Notification.user_id == user.user_id, Notification.is_read == False)  # noqa: E712
        .values(is_read=True)
    )
    await db.commit()
    return {"ok": True}


# ── Helpers ──

def _job_to_response(job) -> JobResponse:
    return JobResponse(
        id=str(job.id),
        type=job.type,
        status=job.status,
        title=job.title,
        progress=job.progress,
        input_data=job.input_data,
        result=job.result,
        error_message=job.error_message,
        created_at=job.created_at.isoformat() if job.created_at else "",
        updated_at=job.updated_at.isoformat() if job.updated_at else "",
    )


def _notif_to_response(n) -> NotificationResponse:
    return NotificationResponse(
        id=str(n.id),
        type=n.type,
        title=n.title,
        content=n.content,
        is_read=n.is_read,
        job_id=str(n.job_id) if n.job_id else None,
        created_at=n.created_at.isoformat() if n.created_at else "",
    )
