"""教师端数据查询路由 — 含分析、导出功能。"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_teacher
from app.models.message import Message
from app.models.user import User
from app.models.group import Group, GroupMember, GroupRoleObjection
from app.models.assignment import (
    Assignment,
    AssignmentPeerReview,
    AssignmentSelfReview,
    AssignmentTask,
    AssignmentTaskTarget,
)
from app.models.ai_conversation import AiConversation
from app.db.json_utils import jq, jq_truthy
from app.services.peer_review_assignment import (
    SubmissionCandidate,
    build_balanced_peer_review_pairs,
)
from app.services.analytics_service import (
    build_teacher_analytics,
    run_bloom_analysis,
)
from app.services.group_roles import (
    COLLABORATION_ROLES,
    assign_role_to_member,
    role_payload,
)
from app.llm.factory import get_llm_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/teacher", tags=["teacher"])




# ────────────────────── 学生管理 ──────────────────────

@router.get("/students")
async def list_students(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """获取所有学生列表（含统计信息）。"""
    offset = (page - 1) * page_size

    result = await db.execute(
        select(User)
        .where(User.role == "student")
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    students = result.scalars().all()

    count_result = await db.execute(
        select(func.count()).where(User.role == "student")
    )
    total = count_result.scalar() or 0

    student_ids = [str(s.user_id) for s in students]
    msg_map: dict = {}
    if student_ids:
        try:
            # 直接按 recipient_id 统计（不依赖 JSON 提取）
            msg_counts = await db.execute(
                select(
                    Message.recipient_id.label("uid"),
                    func.count().label("cnt"),
                )
                .where(Message.recipient_id.in_(student_ids))
                .group_by(Message.recipient_id)
            )
            msg_map = {row.uid: row.cnt for row in msg_counts}
        except Exception as e:
            logger.warning("Message count query failed: %s", e)
            await db.rollback()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "students": [
            {
                "user_id": str(s.user_id),
                "email": s.email,
                "name": s.name,
                "created_at": s.created_at.isoformat(),
                "message_count": msg_map.get(str(s.user_id), 0),
            }
            for s in students
        ],
    }


# ────────────────────── 消息日志 ──────────────────────

@router.get("/messages")
async def list_messages(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
    session_id: str | None = None,
    user_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """查看消息日志。支持按 session 或用户筛选。"""
    offset = (page - 1) * page_size
    q = select(Message).order_by(Message.created_at.desc())

    if session_id:
        q = q.where(Message.session_id == session_id)
    if user_id:
        q = q.where(jq(Message.sender, 'id') == user_id)

    result = await db.execute(q.offset(offset).limit(page_size))
    messages = result.scalars().all()

    count_q = select(func.count()).select_from(Message)
    if session_id:
        count_q = count_q.where(Message.session_id == session_id)
    if user_id:
        count_q = count_q.where(jq(Message.sender, 'id') == user_id)
    total = (await db.execute(count_q)).scalar() or 0

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "messages": [
            {
                "message_id": m.message_id,
                "session_id": m.session_id,
                "sender": m.sender,
                "content": m.content,
                "timing": m.timing,
                "metadata_info": m.metadata_info,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ],
    }


# ────────────────────── 统计概览 ──────────────────────

@router.get("/stats")
async def get_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师仪表盘统计数据。"""
    student_count = (
        await db.execute(select(func.count()).where(User.role == "student"))
    ).scalar() or 0

    group_count = (
        await db.execute(select(func.count()).select_from(Group))
    ).scalar() or 0

    message_count = (
        await db.execute(select(func.count()).select_from(Message))
    ).scalar() or 0

    ai_message_count = (
        await db.execute(
            select(func.count()).where(
                jq(Message.sender, 'role') == "ai"
            )
        )
    ).scalar() or 0

    assignment_count = (
        await db.execute(select(func.count()).select_from(Assignment))
    ).scalar() or 0

    # 支架使用次数
    scaffold_usage_count = (
        await db.execute(
            select(func.count()).where(
                jq_truthy(Message.metadata_info, "is_scaffold_used")
            )
        )
    ).scalar() or 0

    return {
        "student_count": student_count,
        "group_count": group_count,
        "message_count": message_count,
        "ai_message_count": ai_message_count,
        "assignment_count": assignment_count,
        "scaffold_usage_count": scaffold_usage_count,
    }


# ────────────────────── 会话列表 ──────────────────────

@router.get("/sessions")
async def list_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """获取所有会话列表及消息计数。"""
    offset = (page - 1) * page_size
    result = await db.execute(
        select(
            Message.session_id,
            func.count().label("message_count"),
            func.max(Message.created_at).label("last_activity"),
        )
        .group_by(Message.session_id)
        .order_by(func.max(Message.created_at).desc())
        .offset(offset)
        .limit(page_size)
    )
    sessions = result.all()

    return {
        "sessions": [
            {
                "session_id": s.session_id,
                "message_count": s.message_count,
                "last_activity": s.last_activity.isoformat() if s.last_activity else None,
            }
            for s in sessions
        ],
    }


# ────────────────────── 作业任务 / 作业列表 ──────────────────────


class AssignmentTaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    target_student_ids: list[str] = Field(..., min_length=1)
    peer_review_count: int = Field(5, ge=1, le=10)


def _assignment_payload(a: Assignment | None) -> dict | None:
    if a is None:
        return None
    return {
        "assignment_id": str(a.assignment_id),
        "task_id": a.task_id,
        "session_id": a.session_id,
        "student_id": a.student_id,
        "content": a.content,
        "file_url": a.file_url,
        "status": a.status,
        "ai_review": a.ai_review,
        "teacher_review": a.teacher_review,
        "created_at": a.created_at.isoformat(),
    }


def _self_review_payload(review: AssignmentSelfReview | None) -> dict | None:
    if review is None:
        return None
    return {
        "id": review.id,
        "assignment_id": review.assignment_id,
        "student_id": review.student_id,
        "score": review.score,
        "comment": review.comment,
        "created_at": review.created_at.isoformat(),
        "updated_at": review.updated_at.isoformat(),
    }


def _peer_review_payload(
    review: AssignmentPeerReview,
    reviewer: User | None = None,
    reviewee: User | None = None,
) -> dict:
    return {
        "id": review.id,
        "task_id": review.task_id,
        "assignment_id": review.assignment_id,
        "reviewer_id": review.reviewer_id,
        "reviewer_name": reviewer.name if reviewer else "",
        "reviewer_email": reviewer.email if reviewer else "",
        "reviewee_id": review.reviewee_id,
        "reviewee_name": reviewee.name if reviewee else "",
        "reviewee_email": reviewee.email if reviewee else "",
        "score": review.score,
        "comment": review.comment,
        "status": review.status,
        "assigned_at": review.assigned_at.isoformat(),
        "submitted_at": (
            review.submitted_at.isoformat() if review.submitted_at else None
        ),
    }


def _task_base_payload(task: AssignmentTask) -> dict:
    return {
        "task_id": task.task_id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "peer_review_count": task.peer_review_count,
        "created_by": task.created_by,
        "peer_review_started_at": (
            task.peer_review_started_at.isoformat()
            if task.peer_review_started_at else None
        ),
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
    }


async def _assignment_task_summary(
    db: AsyncSession,
    task: AssignmentTask,
) -> dict:
    target_count = (
        await db.execute(
            select(func.count()).select_from(AssignmentTaskTarget)
            .where(AssignmentTaskTarget.task_id == task.task_id)
        )
    ).scalar() or 0
    submitted_count = (
        await db.execute(
            select(func.count()).select_from(Assignment)
            .where(Assignment.task_id == task.task_id)
        )
    ).scalar() or 0
    self_review_count = (
        await db.execute(
            select(func.count()).select_from(AssignmentSelfReview)
            .where(AssignmentSelfReview.task_id == task.task_id)
        )
    ).scalar() or 0
    peer_total = (
        await db.execute(
            select(func.count()).select_from(AssignmentPeerReview)
            .where(AssignmentPeerReview.task_id == task.task_id)
        )
    ).scalar() or 0
    peer_completed = (
        await db.execute(
            select(func.count()).select_from(AssignmentPeerReview)
            .where(
                AssignmentPeerReview.task_id == task.task_id,
                AssignmentPeerReview.status == "submitted",
            )
        )
    ).scalar() or 0
    teacher_reviewed_count = (
        await db.execute(
            select(func.count()).select_from(Assignment)
            .where(
                Assignment.task_id == task.task_id,
                Assignment.teacher_review.is_not(None),
            )
        )
    ).scalar() or 0

    return {
        **_task_base_payload(task),
        "target_count": target_count,
        "submitted_count": submitted_count,
        "missing_count": max(target_count - submitted_count, 0),
        "self_review_count": self_review_count,
        "peer_review_total": peer_total,
        "peer_review_completed": peer_completed,
        "teacher_reviewed_count": teacher_reviewed_count,
    }


async def _get_assignment_task_or_404(
    db: AsyncSession,
    task_id: str,
) -> AssignmentTask:
    result = await db.execute(
        select(AssignmentTask).where(AssignmentTask.task_id == task_id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "作业任务不存在")
    return task


@router.get("/assignment-tasks")
async def list_assignment_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师查看作业任务列表。"""
    result = await db.execute(
        select(AssignmentTask).order_by(AssignmentTask.created_at.desc())
    )
    tasks = result.scalars().all()
    return [await _assignment_task_summary(db, task) for task in tasks]


@router.post("/assignment-tasks")
async def create_assignment_task(
    body: AssignmentTaskCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(require_teacher)],
):
    """教师筛选学生并发布作业任务。"""
    target_ids = list(dict.fromkeys(body.target_student_ids))
    result = await db.execute(
        select(User).where(User.user_id.in_(target_ids), User.role == "student")
    )
    students = result.scalars().all()
    found_ids = {s.user_id for s in students}
    missing_ids = [sid for sid in target_ids if sid not in found_ids]
    if missing_ids:
        raise HTTPException(400, f"存在无效学生 ID: {', '.join(missing_ids)}")

    task = AssignmentTask(
        title=body.title.strip(),
        description=body.description.strip() if body.description else None,
        status="published",
        peer_review_count=body.peer_review_count,
        created_by=teacher.user_id,
    )
    db.add(task)
    await db.flush()
    for student_id in target_ids:
        db.add(AssignmentTaskTarget(task_id=task.task_id, student_id=student_id))
    await db.commit()
    await db.refresh(task)
    return await _assignment_task_summary(db, task)


@router.get("/assignment-tasks/{task_id}")
async def get_assignment_task_detail(
    task_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师查看单个作业任务的实名提交、自评和互评情况。"""
    task = await _get_assignment_task_or_404(db, task_id)
    target_result = await db.execute(
        select(AssignmentTaskTarget, User)
        .join(User, User.user_id == AssignmentTaskTarget.student_id)
        .where(AssignmentTaskTarget.task_id == task_id)
        .order_by(User.name.asc())
    )
    target_rows = target_result.all()
    target_ids = [target.student_id for target, _user in target_rows]

    assignment_result = await db.execute(
        select(Assignment).where(Assignment.task_id == task_id)
    )
    assignments = assignment_result.scalars().all()
    assignments_by_student = {a.student_id: a for a in assignments}

    self_result = await db.execute(
        select(AssignmentSelfReview).where(AssignmentSelfReview.task_id == task_id)
    )
    self_reviews = self_result.scalars().all()
    self_by_student = {r.student_id: r for r in self_reviews}

    peer_result = await db.execute(
        select(AssignmentPeerReview, User)
        .join(User, User.user_id == AssignmentPeerReview.reviewer_id)
        .where(AssignmentPeerReview.task_id == task_id)
        .order_by(AssignmentPeerReview.assigned_at.asc())
    )
    reviewer_user_by_id = {
        review.reviewer_id: reviewer for review, reviewer in peer_result.all()
    }

    reviewee_users = {user.user_id: user for _target, user in target_rows}
    peer_result = await db.execute(
        select(AssignmentPeerReview).where(AssignmentPeerReview.task_id == task_id)
    )
    peer_reviews = peer_result.scalars().all()
    peer_by_reviewee: dict[str, list[dict]] = {}
    peer_by_reviewer: dict[str, list[dict]] = {}
    for review in peer_reviews:
        payload = _peer_review_payload(
            review,
            reviewer=reviewer_user_by_id.get(review.reviewer_id),
            reviewee=reviewee_users.get(review.reviewee_id),
        )
        peer_by_reviewee.setdefault(review.reviewee_id, []).append(payload)
        peer_by_reviewer.setdefault(review.reviewer_id, []).append(payload)

    targets = []
    for target, student in target_rows:
        assignment = assignments_by_student.get(target.student_id)
        targets.append({
            "student_id": target.student_id,
            "student_name": student.name,
            "student_email": student.email,
            "assigned_at": target.assigned_at.isoformat(),
            "assignment": _assignment_payload(assignment),
            "self_review": _self_review_payload(
                self_by_student.get(target.student_id)
            ),
            "peer_reviews_received": peer_by_reviewee.get(target.student_id, []),
            "peer_reviews_assigned": peer_by_reviewer.get(target.student_id, []),
        })

    return {
        "task": await _assignment_task_summary(db, task),
        "target_student_ids": target_ids,
        "targets": targets,
    }


@router.post("/assignment-tasks/{task_id}/start-peer-review")
async def start_peer_review(
    task_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师手动开启互评并生成均衡匿名分配。"""
    task = await _get_assignment_task_or_404(db, task_id)
    existing_count = (
        await db.execute(
            select(func.count()).select_from(AssignmentPeerReview)
            .where(AssignmentPeerReview.task_id == task_id)
        )
    ).scalar() or 0
    if existing_count:
        return await _assignment_task_summary(db, task)
    if task.status != "published":
        raise HTTPException(400, "只有已发布且未开启互评的任务可以开启互评")

    target_result = await db.execute(
        select(AssignmentTaskTarget).where(AssignmentTaskTarget.task_id == task_id)
    )
    targets = target_result.scalars().all()
    reviewer_ids = [target.student_id for target in targets]

    assignment_result = await db.execute(
        select(Assignment).where(Assignment.task_id == task_id)
    )
    assignments = assignment_result.scalars().all()
    submissions = [
        SubmissionCandidate(
            assignment_id=str(assignment.assignment_id),
            student_id=assignment.student_id,
        )
        for assignment in assignments
    ]

    try:
        pairs = build_balanced_peer_review_pairs(
            reviewer_ids=reviewer_ids,
            submissions=submissions,
            peer_review_count=task.peer_review_count,
            seed=task.task_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    for pair in pairs:
        db.add(
            AssignmentPeerReview(
                task_id=task_id,
                assignment_id=pair.assignment_id,
                reviewer_id=pair.reviewer_id,
                reviewee_id=pair.reviewee_id,
            )
        )
    task.status = "peer_review"
    task.peer_review_started_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(task)
    return await _assignment_task_summary(db, task)

@router.get("/assignments")
async def list_assignments(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """获取所有作业列表（含学生姓名）。"""
    result = await db.execute(
        select(Assignment, User)
        .outerjoin(User, Assignment.student_id == User.user_id)
        .order_by(Assignment.created_at.desc())
    )
    rows = result.all()

    return [
        {
            "assignment_id": str(a.assignment_id),
            "task_id": a.task_id,
            "session_id": a.session_id,
            "student_id": a.student_id,
            "student_name": u.name if u else "未知",
            "student_email": u.email if u else "",
            "content": a.content,
            "file_url": a.file_url,
            "status": a.status,
            "ai_review": a.ai_review,
            "teacher_review": a.teacher_review,
            "created_at": a.created_at.isoformat(),
        }
        for a, u in rows
    ]


# ────────────────────── P1-5: 学习分析 ──────────────────────

@router.post("/analytics/bloom")
async def bloom_analysis(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """LLM 驱动的 Bloom 认知层次分析。"""
    try:
        llm = get_llm_client("deepseek")
        result = await run_bloom_analysis(db, llm)
        return result
    except Exception as e:
        logger.error("Bloom analysis failed: %s", e)
        return {"levels": {}, "total": 0, "details": [], "error": str(e)}


@router.get("/analytics")
async def get_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """深度分析数据：支架热力图、AI介入率、参与度等。"""
    return await build_teacher_analytics(db)


# ────────────────────── 导出 CSV ──────────────────────

@router.get("/export/messages")
async def export_messages_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
    session_id: str | None = None,
):
    """高精度教研日志导出（白皮书 B-03）。

    CSV 含：绝对时间、开课相对分钟数、发言者角色、
    支架使用标记（含 legacy 状态）、逻辑谬误标记。
    """
    q = select(Message).order_by(Message.created_at.asc())
    if session_id:
        q = q.where(Message.session_id == session_id)

    result = await db.execute(q.limit(10000))
    msgs = result.scalars().all()

    # 计算相对分钟数：以该 session 第一条消息为基准
    first_time = {}
    for m in msgs:
        if m.session_id not in first_time and m.created_at:
            first_time[m.session_id] = m.created_at

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "message_id", "session_id", "sender_id", "sender_name",
        "sender_role", "content", "absolute_time", "relative_minute",
        "is_scaffold_used", "scaffold_name", "scaffold_status",
        "is_fallacy_intervention", "llm_provider",
    ])

    for m in msgs:
        sender = m.sender if isinstance(m.sender, dict) else {}
        meta = m.metadata_info if isinstance(m.metadata_info, dict) else {}
        scaffold_info = meta.get("scaffold_info", {}) or {}

        # 相对分钟数
        rel_min = ""
        if m.created_at and m.session_id in first_time:
            delta = (m.created_at - first_time[m.session_id]).total_seconds()
            rel_min = round(delta / 60, 1)

        writer.writerow([
            m.message_id,
            m.session_id,
            sender.get("id", ""),
            sender.get("name", ""),
            sender.get("role", ""),
            m.content,
            m.created_at.isoformat() if m.created_at else "",
            rel_min,
            meta.get("is_scaffold_used", False),
            scaffold_info.get("name", ""),
            scaffold_info.get("status", ""),  # active / legacy
            meta.get("is_fallacy_intervention", False),
            meta.get("llm_provider", ""),
        ])

    output.seek(0)
    # Risk 2: UTF-8 BOM 防止 Windows Excel 中文乱码
    bom = "\ufeff"
    return StreamingResponse(
        iter([bom + output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=messages.csv"},
    )


# ────────────────────── AI 对话记录 ──────────────────────

@router.get("/ai-conversations")
async def list_all_ai_conversations(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
    student_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
):
    """教师查看所有学生的 AI 对话会话列表。"""
    q = (
        select(
            AiConversation,
            User.name.label("student_name"),
            User.email.label("student_email"),
        )
        .join(User, User.user_id == AiConversation.user_id)
        .order_by(AiConversation.updated_at.desc())
    )
    if student_id:
        q = q.where(AiConversation.user_id == student_id)

    # 总数
    count_q = select(func.count()).select_from(
        q.subquery()
    )
    total = (await db.execute(count_q)).scalar() or 0

    result = await db.execute(
        q.offset((page - 1) * page_size).limit(page_size)
    )
    rows = result.all()

    return {
        "total": total,
        "page": page,
        "conversations": [
            {
                "conversation_id": c.conversation_id,
                "student_id": c.user_id,
                "student_name": name,
                "student_email": email,
                "title": c.title,
                "llm_provider": c.llm_provider,
                "message_count": c.message_count,
                "created_at": c.created_at.isoformat() if c.created_at else "",
                "updated_at": c.updated_at.isoformat() if c.updated_at else "",
            }
            for c, name, email in rows
        ],
    }


@router.get("/ai-conversations/export")
async def export_ai_conversations_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """导出所有 AI 对话记录为 CSV。"""
    result = await db.execute(
        select(
            AiConversation.conversation_id,
            AiConversation.title,
            User.name.label("student_name"),
            User.email.label("student_email"),
            Message.message_id,
            Message.sender,
            Message.content,
            Message.created_at,
        )
        .join(User, User.user_id == AiConversation.user_id)
        .join(
            Message,
            Message.conversation_id == AiConversation.conversation_id,
        )
        .order_by(
            AiConversation.updated_at.desc(),
            Message.created_at.asc(),
        )
        .limit(50000)
    )
    rows = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "conversation_id", "title", "student_name", "student_email",
        "message_id", "sender_name", "sender_role", "content", "created_at",
    ])
    for r in rows:
        sender = r.sender if isinstance(r.sender, dict) else {}
        writer.writerow([
            r.conversation_id,
            r.title,
            r.student_name,
            r.student_email,
            r.message_id,
            sender.get("name", ""),
            sender.get("role", ""),
            r.content,
            r.created_at.isoformat() if r.created_at else "",
        ])

    output.seek(0)
    bom = "\ufeff"
    return StreamingResponse(
        iter([bom + output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": "attachment; filename=ai_conversations.csv"
        },
    )


@router.get("/ai-conversations/{conversation_id}/messages")
async def get_ai_conversation_messages(
    conversation_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师查看某对话的全部消息。"""
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    msgs = result.scalars().all()
    return [
        {
            "message_id": m.message_id,
            "sender": m.sender if isinstance(m.sender, dict) else {},
            "content": m.content,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in msgs
    ]


# ────────────────────── 统一对话记录查询 ──────────────────────

@router.get("/unified-messages")
async def list_unified_messages(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
    type: str = Query("all", pattern="^(all|group|personal)$"),
    student_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=200),
):
    """合并小组消息 + AI 1v1 对话的统一列表。

    - type=group    → conversation_id IS NULL（小组聊天）
    - type=personal → conversation_id IS NOT NULL（AI 1v1）
    - type=all      → 全部
    """
    offset = (page - 1) * page_size

    # 基础查询：Message LEFT JOIN Group（获取 group_name）
    q = (
        select(
            Message,
            Group.name.label("group_name"),
        )
        .outerjoin(Group, Message.session_id == Group.id)
        .order_by(Message.created_at.desc())
    )

    # 类型筛选
    if type == "group":
        q = q.where(Message.conversation_id.is_(None))
    elif type == "personal":
        q = q.where(Message.conversation_id.is_not(None))

    # 学生筛选
    if student_id:
        q = q.where(
            (jq(Message.sender, "id") == student_id)
            | (Message.recipient_id == student_id)
        )

    # 总数
    from sqlalchemy import text as sa_text
    count_sub = q.subquery()
    total = (await db.execute(
        select(func.count()).select_from(count_sub)
    )).scalar() or 0

    result = await db.execute(q.offset(offset).limit(page_size))
    rows = result.all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "messages": [
            {
                "message_id": m.message_id,
                "session_id": m.session_id,
                "conversation_id": m.conversation_id,
                "chat_type": "personal" if m.conversation_id else "group",
                "group_name": group_name or "",
                "sender": m.sender if isinstance(m.sender, dict) else {},
                "content": m.content,
                "timing": m.timing,
                "metadata_info": m.metadata_info if isinstance(m.metadata_info, dict) else {},
                "created_at": m.created_at.isoformat() if m.created_at else "",
            }
            for m, group_name in rows
        ],
    }


# ────────────────────── 统一 CSV 导出 ──────────────────────

@router.get("/export/unified")
async def export_unified_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """统一导出所有消息（小组 + AI 1v1）为 CSV。

    - session_type: personalchat / groupchat
    - message_id:   MSG-组名-001（小组） / MSG-001（个人）
    - relative_minute: 以 session 内第一条消息为基准的分钟偏移
    """
    # 一次性查所有消息 + 组名
    result = await db.execute(
        select(Message, Group.name.label("group_name"))
        .outerjoin(Group, Message.session_id == Group.id)
        .order_by(Message.created_at.asc())
        .limit(50000)
    )
    rows = result.all()

    # 预计算每个 session 的第一条消息时间 & 每 session 递增序号
    first_time: dict[str, datetime] = {}
    session_counters: dict[str, int] = {}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "message_id", "session_type", "group_name",
        "sender_name", "sender_role", "content",
        "absolute_time", "relative_minute",
        "is_scaffold_used", "scaffold_name",
    ])

    for m, group_name in rows:
        sender = m.sender if isinstance(m.sender, dict) else {}
        meta = m.metadata_info if isinstance(m.metadata_info, dict) else {}
        scaffold_info = meta.get("scaffold_info", {}) or {}

        is_personal = m.conversation_id is not None
        session_type = "personalchat" if is_personal else "groupchat"
        gname = group_name or ""

        # 每 session 递增序号
        session_key = m.conversation_id if is_personal else m.session_id
        session_counters[session_key] = session_counters.get(session_key, 0) + 1
        seq = session_counters[session_key]

        # 可读 message_id
        if is_personal:
            readable_id = f"MSG-{seq:03d}"
        else:
            if not gname:
                gname = f"已解散小组({str(session_key)[-6:]})"
            readable_id = f"MSG-{gname}-{seq:03d}"

        # 相对分钟数
        rel_min = ""
        if m.created_at and session_key:
            if session_key not in first_time:
                first_time[session_key] = m.created_at
            delta = (m.created_at - first_time[session_key]).total_seconds()
            rel_min = round(delta / 60, 1)

        writer.writerow([
            readable_id,
            session_type,
            gname,
            sender.get("name", ""),
            sender.get("role", ""),
            m.content,
            m.created_at.isoformat() if m.created_at else "",
            rel_min,
            meta.get("is_scaffold_used", False),
            scaffold_info.get("name", ""),
        ])

    output.seek(0)
    bom = "\ufeff"
    return StreamingResponse(
        iter([bom + output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=unified_messages.csv"},
    )


# ────────────────────── 教师端小组管理 ──────────────────────


@router.get("/groups")
async def list_all_groups(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师查看所有小组及其成员列表。"""
    result = await db.execute(
        select(Group).order_by(Group.created_at.desc())
    )
    groups = result.scalars().all()

    group_data = []
    for g in groups:
        # 获取每个小组的成员列表
        members_result = await db.execute(
            select(GroupMember, User)
            .join(User, User.user_id == GroupMember.user_id)
            .where(GroupMember.group_id == g.id)
            .order_by(GroupMember.joined_at.asc())
        )
        member_rows = members_result.all()
        existing_roles = [gm.collaboration_role for gm, _u in member_rows]
        changed = False
        for gm, _u in member_rows:
            if not gm.collaboration_role:
                assign_role_to_member(gm, existing_roles, "system")
                existing_roles.append(gm.collaboration_role)
                db.add(gm)
                changed = True
        if changed:
            await db.commit()

        objections_result = await db.execute(
            select(GroupRoleObjection).where(
                GroupRoleObjection.group_id == g.id,
                GroupRoleObjection.status == "pending",
            )
        )
        pending_by_user = {
            objection.user_id: objection
            for objection in objections_result.scalars().all()
        }

        members = []
        for gm, u in member_rows:
            pending = pending_by_user.get(gm.user_id)
            role_info = role_payload(gm.collaboration_role)
            members.append({
                "user_id": gm.user_id,
                "name": u.name,
                "email": u.email,
                "role": gm.role,
                "collaboration_role": role_info["role"],
                "collaboration_role_description": role_info["description"],
                "collaboration_role_prompt": role_info["prompt"],
                "role_assigned_by": gm.role_assigned_by or "system",
                "role_assigned_at": gm.role_assigned_at.isoformat() if gm.role_assigned_at else None,
                "pending_role_objection": (
                    {
                        "id": pending.id,
                        "reason": pending.reason,
                        "note": pending.note,
                        "created_at": pending.created_at.isoformat() if pending.created_at else "",
                    }
                    if pending
                    else None
                ),
                "joined_at": gm.joined_at.isoformat() if gm.joined_at else "",
            })
        group_data.append({
            "id": g.id,
            "name": g.name,
            "invite_code": g.invite_code,
            "created_by": g.created_by,
            "created_at": g.created_at.isoformat() if g.created_at else "",
            "current_stage": g.current_stage,
            "member_count": len(members),
            "members": members,
        })

    return group_data


class CollaborationRoleUpdateBody(BaseModel):
    collaboration_role: str


@router.patch("/groups/{group_id}/members/{user_id}/collaboration-role")
async def update_member_collaboration_role(
    group_id: str,
    user_id: str,
    body: CollaborationRoleUpdateBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(require_teacher)],
):
    """教师手动调整小组成员协作角色。"""
    if body.collaboration_role not in COLLABORATION_ROLES:
        raise HTTPException(status_code=422, detail="无效协作角色")

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="小组成员不存在")

    member.collaboration_role = body.collaboration_role
    member.role_assigned_by = "teacher"
    member.role_assigned_at = datetime.now(timezone.utc)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    role_info = role_payload(member.collaboration_role)
    return {
        "group_id": group_id,
        "user_id": user_id,
        "collaboration_role": role_info["role"],
        "description": role_info["description"],
        "prompt": role_info["prompt"],
        "role_assigned_by": member.role_assigned_by,
        "role_assigned_at": member.role_assigned_at.isoformat() if member.role_assigned_at else None,
        "updated_by": str(teacher.user_id),
    }


@router.get("/group-role-objections")
async def list_group_role_objections(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
    status: str = "pending",
):
    """教师查看角色异议列表。"""
    result = await db.execute(
        select(GroupRoleObjection, Group.name.label("group_name"), User.name.label("student_name"))
        .join(Group, Group.id == GroupRoleObjection.group_id)
        .join(User, User.user_id == GroupRoleObjection.user_id)
        .where(GroupRoleObjection.status == status)
        .order_by(GroupRoleObjection.created_at.desc())
    )
    return [
        {
            "id": objection.id,
            "group_id": objection.group_id,
            "group_name": group_name,
            "user_id": objection.user_id,
            "student_name": student_name,
            "current_role": objection.current_role,
            "reason": objection.reason,
            "note": objection.note,
            "status": objection.status,
            "created_at": objection.created_at.isoformat() if objection.created_at else "",
        }
        for objection, group_name, student_name in result.all()
    ]


class RoleObjectionResolveBody(BaseModel):
    status: str
    collaboration_role: str | None = None
    resolution_note: str | None = None


@router.post("/group-role-objections/{objection_id}/resolve")
async def resolve_group_role_objection(
    objection_id: str,
    body: RoleObjectionResolveBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(require_teacher)],
):
    """教师处理学生角色异议。"""
    if body.status not in {"resolved", "rejected"}:
        raise HTTPException(status_code=422, detail="处理状态必须是 resolved 或 rejected")
    if body.collaboration_role and body.collaboration_role not in COLLABORATION_ROLES:
        raise HTTPException(status_code=422, detail="无效协作角色")

    result = await db.execute(
        select(GroupRoleObjection).where(GroupRoleObjection.id == objection_id)
    )
    objection = result.scalar_one_or_none()
    if not objection:
        raise HTTPException(status_code=404, detail="角色异议不存在")
    if objection.status != "pending":
        raise HTTPException(status_code=409, detail="该异议已处理")

    if body.status == "resolved" and body.collaboration_role:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == objection.group_id,
                GroupMember.user_id == objection.user_id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=404, detail="小组成员不存在")
        member.collaboration_role = body.collaboration_role
        member.role_assigned_by = "teacher"
        member.role_assigned_at = datetime.now(timezone.utc)
        db.add(member)

    objection.status = body.status
    objection.resolution_note = body.resolution_note
    objection.resolved_by = str(teacher.user_id)
    objection.resolved_at = datetime.now(timezone.utc)
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
        "resolution_note": objection.resolution_note,
        "resolved_by": objection.resolved_by,
        "resolved_at": objection.resolved_at.isoformat() if objection.resolved_at else None,
    }


@router.post("/groups/{group_id}/collaboration-roles/rebalance")
async def rebalance_group_collaboration_roles(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师触发某个小组重新均衡分配协作角色。"""
    members_result = await db.execute(
        select(GroupMember)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at.asc())
    )
    members = members_result.scalars().all()
    if not members:
        raise HTTPException(status_code=404, detail="小组不存在或暂无成员")

    assigned_roles: list[str | None] = []
    for member in members:
        assign_role_to_member(member, assigned_roles, "system")
        assigned_roles.append(member.collaboration_role)
        db.add(member)
    await db.commit()
    return {
        "group_id": group_id,
        "members": [
            {
                "user_id": member.user_id,
                "collaboration_role": member.collaboration_role,
                "role_assigned_by": member.role_assigned_by,
            }
            for member in members
        ],
    }


@router.delete("/groups/{group_id}/members/{user_id}")
async def remove_group_member(
    group_id: str,
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师将学生移出小组。"""
    from sqlalchemy import delete as sql_delete

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="该学生不在此小组中")

    await db.execute(
        sql_delete(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        )
    )
    await db.commit()
    return {"status": "removed", "group_id": group_id, "user_id": user_id}


class TransferMemberBody(BaseModel):
    target_group_id: str


@router.post("/groups/{group_id}/members/{user_id}/transfer")
async def transfer_group_member(
    group_id: str,
    user_id: str,
    body: TransferMemberBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师将学生从一个小组转移到另一个小组。"""
    from sqlalchemy import delete as sql_delete
    from fastapi import HTTPException

    # 验证源小组中存在该成员
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="该学生不在源小组中")

    # 验证目标小组存在
    target = await db.execute(
        select(Group).where(Group.id == body.target_group_id)
    )
    if not target.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="目标小组不存在")

    # 检查目标小组是否已包含该成员
    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == body.target_group_id,
            GroupMember.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="该学生已在目标小组中")

    # 删除旧成员记录
    await db.execute(
        sql_delete(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        )
    )

    # 添加到新小组
    new_member = GroupMember(
        group_id=body.target_group_id,
        user_id=user_id,
        role="member",
    )
    db.add(new_member)
    await db.commit()

    return {
        "status": "transferred",
        "user_id": user_id,
        "from_group": group_id,
        "to_group": body.target_group_id,
    }


class GroupRenameBody(BaseModel):
    name: str


@router.patch("/groups/{group_id}")
async def teacher_rename_group(
    group_id: str,
    body: GroupRenameBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师重命名小组。"""
    from fastapi import HTTPException

    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="小组不存在")

    group.name = body.name.strip()
    db.add(group)
    await db.commit()
    await db.refresh(group)

    return {
        "id": group.id,
        "name": group.name,
        "invite_code": group.invite_code,
    }


@router.delete("/groups/{group_id}")
async def teacher_delete_group(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师删除整个小组。"""
    from sqlalchemy import delete as sql_delete
    from fastapi import HTTPException

    result = await db.execute(select(Group).where(Group.id == group_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="小组不存在")

    await db.execute(
        sql_delete(GroupMember).where(GroupMember.group_id == group_id)
    )
    await db.execute(
        sql_delete(Group).where(Group.id == group_id)
    )
    await db.commit()

    return {"status": "deleted", "group_id": group_id}


# ────────────────────── 教师端设置 ──────────────────────

_SCAFFOLD_SUGGEST_KEY = "cothink:config:scaffold_suggest_enabled"


@router.get("/settings/scaffold-suggest")
async def get_scaffold_suggest_setting(
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """查询支架智能推送开关状态。"""
    from app.infra.redis_client import is_available, get_redis

    enabled = True  # 默认启用
    if is_available():
        pool = get_redis()
        if pool:
            val = await pool.get(_SCAFFOLD_SUGGEST_KEY)
            if val is not None:
                enabled = str(val).lower() != "false"
    return {"enabled": enabled}


class ScaffoldSuggestBody(BaseModel):
    enabled: bool


@router.put("/settings/scaffold-suggest")
async def set_scaffold_suggest_setting(
    body: ScaffoldSuggestBody,
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """切换支架智能推送开关。"""
    from app.infra.redis_client import is_available, get_redis

    if is_available():
        pool = get_redis()
        if pool:
            await pool.set(_SCAFFOLD_SUGGEST_KEY, str(body.enabled).lower())
            return {"enabled": body.enabled}

    raise HTTPException(
        status_code=503, detail="Redis 不可用，无法保存配置"
    )
