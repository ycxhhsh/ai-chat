"""作业相关路由 — 提交、AI 评分、教师复核。"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_teacher
from app.models.assignment import (
    Assignment,
    AssignmentPeerReview,
    AssignmentSelfReview,
    AssignmentTask,
    AssignmentTaskTarget,
)
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assignments", tags=["assignments"])


class AssignmentSubmit(BaseModel):
    session_id: str = "assignment"
    content: str
    file_url: str | None = None


class AssignmentTaskSubmit(BaseModel):
    content: str
    file_url: str | None = None


class ReviewSubmit(BaseModel):
    score: int = Field(..., ge=0, le=100)
    comment: str | None = None


class TeacherReview(BaseModel):
    score: int | None = None
    comment: str | None = None


def _task_payload(task: AssignmentTask) -> dict:
    return {
        "task_id": task.task_id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "peer_review_count": task.peer_review_count,
        "peer_review_started_at": (
            task.peer_review_started_at.isoformat()
            if task.peer_review_started_at else None
        ),
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
    }


def _assignment_payload(assignment: Assignment | None) -> dict | None:
    if assignment is None:
        return None
    return {
        "assignment_id": str(assignment.assignment_id),
        "task_id": assignment.task_id,
        "session_id": assignment.session_id,
        "student_id": assignment.student_id,
        "content": assignment.content,
        "file_url": assignment.file_url,
        "status": assignment.status,
        "ai_review": assignment.ai_review,
        "teacher_review": assignment.teacher_review,
        "created_at": assignment.created_at.isoformat(),
    }


def _self_review_payload(review: AssignmentSelfReview | None) -> dict | None:
    if review is None:
        return None
    return {
        "id": review.id,
        "task_id": review.task_id,
        "assignment_id": review.assignment_id,
        "student_id": review.student_id,
        "score": review.score,
        "comment": review.comment,
        "created_at": review.created_at.isoformat(),
        "updated_at": review.updated_at.isoformat(),
    }


async def _require_task_target(
    db: AsyncSession,
    task_id: str,
    student_id: str,
) -> AssignmentTask:
    result = await db.execute(
        select(AssignmentTask, AssignmentTaskTarget)
        .join(
            AssignmentTaskTarget,
            AssignmentTask.task_id == AssignmentTaskTarget.task_id,
        )
        .where(
            AssignmentTask.task_id == task_id,
            AssignmentTaskTarget.student_id == student_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(404, "作业任务不存在或未发布给你")
    task, _target = row
    return task


async def _my_assignment(
    db: AsyncSession,
    task_id: str,
    student_id: str,
) -> Assignment | None:
    result = await db.execute(
        select(Assignment).where(
            Assignment.task_id == task_id,
            Assignment.student_id == student_id,
        )
    )
    return result.scalar_one_or_none()


async def _my_self_review(
    db: AsyncSession,
    task_id: str,
    student_id: str,
) -> AssignmentSelfReview | None:
    result = await db.execute(
        select(AssignmentSelfReview).where(
            AssignmentSelfReview.task_id == task_id,
            AssignmentSelfReview.student_id == student_id,
        )
    )
    return result.scalar_one_or_none()


async def _student_task_detail(
    db: AsyncSession,
    task: AssignmentTask,
    student_id: str,
) -> dict:
    assignment = await _my_assignment(db, task.task_id, student_id)
    self_review = await _my_self_review(db, task.task_id, student_id)

    assigned_result = await db.execute(
        select(AssignmentPeerReview, Assignment)
        .join(
            Assignment,
            Assignment.assignment_id == AssignmentPeerReview.assignment_id,
        )
        .where(
            AssignmentPeerReview.task_id == task.task_id,
            AssignmentPeerReview.reviewer_id == student_id,
        )
        .order_by(AssignmentPeerReview.assigned_at.asc())
    )
    assigned_reviews = []
    for idx, (review, target_assignment) in enumerate(assigned_result.all(), start=1):
        assigned_reviews.append({
            "id": review.id,
            "task_id": review.task_id,
            "anonymous_label": f"匿名作品 {idx}",
            "content": target_assignment.content,
            "file_url": target_assignment.file_url,
            "score": review.score,
            "comment": review.comment,
            "status": review.status,
            "assigned_at": review.assigned_at.isoformat(),
            "submitted_at": (
                review.submitted_at.isoformat() if review.submitted_at else None
            ),
        })

    received_reviews = []
    if assignment:
        received_result = await db.execute(
            select(AssignmentPeerReview)
            .where(
                AssignmentPeerReview.assignment_id == assignment.assignment_id,
                AssignmentPeerReview.status == "submitted",
            )
            .order_by(AssignmentPeerReview.submitted_at.asc())
        )
        for idx, review in enumerate(received_result.scalars().all(), start=1):
            received_reviews.append({
                "id": review.id,
                "anonymous_label": f"匿名同学 {idx}",
                "score": review.score,
                "comment": review.comment,
                "submitted_at": (
                    review.submitted_at.isoformat()
                    if review.submitted_at else None
                ),
            })

    return {
        "task": _task_payload(task),
        "assignment": _assignment_payload(assignment),
        "self_review": _self_review_payload(self_review),
        "peer_reviews": assigned_reviews,
        "received_peer_reviews": received_reviews,
    }


@router.get("/tasks")
async def list_my_assignment_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生查看发布给自己的作业任务列表。"""
    result = await db.execute(
        select(AssignmentTask)
        .join(
            AssignmentTaskTarget,
            AssignmentTask.task_id == AssignmentTaskTarget.task_id,
        )
        .where(AssignmentTaskTarget.student_id == user.user_id)
        .order_by(AssignmentTask.created_at.desc())
    )
    tasks = result.scalars().all()

    payload = []
    for task in tasks:
        assignment = await _my_assignment(db, task.task_id, user.user_id)
        self_review = await _my_self_review(db, task.task_id, user.user_id)
        peer_result = await db.execute(
            select(AssignmentPeerReview).where(
                AssignmentPeerReview.task_id == task.task_id,
                AssignmentPeerReview.reviewer_id == user.user_id,
            )
        )
        peer_reviews = peer_result.scalars().all()
        payload.append({
            "task": _task_payload(task),
            "assignment": _assignment_payload(assignment),
            "self_review": _self_review_payload(self_review),
            "peer_review_total": len(peer_reviews),
            "peer_review_completed": sum(
                1 for review in peer_reviews if review.status == "submitted"
            ),
        })
    return payload


@router.get("/tasks/{task_id}")
async def get_my_assignment_task(
    task_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生查看单个作业任务详情。"""
    task = await _require_task_target(db, task_id, user.user_id)
    return await _student_task_detail(db, task, user.user_id)


@router.post("/tasks/{task_id}/submit")
async def submit_task_assignment(
    task_id: str,
    body: AssignmentTaskSubmit,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生在指定作业任务内提交或覆盖提交。"""
    task = await _require_task_target(db, task_id, user.user_id)
    if task.status != "published":
        raise HTTPException(400, "互评已开启，不能再提交或修改作业")
    if not body.content.strip() and not body.file_url:
        raise HTTPException(400, "作业内容或附件不能为空")

    assignment = await _my_assignment(db, task_id, user.user_id)
    now = datetime.now(timezone.utc)
    if assignment is None:
        assignment = Assignment(
            task_id=task_id,
            session_id=f"assignment-task:{task_id}",
            student_id=user.user_id,
            content=body.content.strip() or "(附件提交)",
            file_url=body.file_url,
            status="submitted",
            created_at=now,
        )
        db.add(assignment)
    else:
        assignment.content = body.content.strip() or "(附件提交)"
        assignment.file_url = body.file_url
        assignment.status = "submitted"
        assignment.ai_review = None
        assignment.teacher_review = None
        assignment.created_at = now
    await db.commit()
    await db.refresh(assignment)
    return {
        "assignment": _assignment_payload(assignment),
        "task": _task_payload(task),
    }


@router.post("/tasks/{task_id}/self-review")
async def submit_self_review(
    task_id: str,
    body: ReviewSubmit,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生提交或更新自评。"""
    task = await _require_task_target(db, task_id, user.user_id)
    assignment = await _my_assignment(db, task_id, user.user_id)
    if assignment is None:
        raise HTTPException(400, "请先提交作业，再进行自评")

    review = await _my_self_review(db, task_id, user.user_id)
    if review is None:
        review = AssignmentSelfReview(
            task_id=task_id,
            assignment_id=assignment.assignment_id,
            student_id=user.user_id,
            score=body.score,
            comment=body.comment,
        )
        db.add(review)
    else:
        review.assignment_id = assignment.assignment_id
        review.score = body.score
        review.comment = body.comment
    await db.commit()
    await db.refresh(review)
    return {
        "task": _task_payload(task),
        "self_review": _self_review_payload(review),
    }


@router.patch("/peer-reviews/{review_id}")
async def submit_peer_review(
    review_id: str,
    body: ReviewSubmit,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生提交被分配到的匿名互评。"""
    result = await db.execute(
        select(AssignmentPeerReview, AssignmentTask)
        .join(
            AssignmentTask,
            AssignmentTask.task_id == AssignmentPeerReview.task_id,
        )
        .where(
            AssignmentPeerReview.id == review_id,
            AssignmentPeerReview.reviewer_id == user.user_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(404, "互评任务不存在或不属于你")
    review, task = row
    if task.status != "peer_review":
        raise HTTPException(400, "当前任务不在互评阶段")

    review.score = body.score
    review.comment = body.comment
    review.status = "submitted"
    review.submitted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(review)
    return {
        "id": review.id,
        "task_id": review.task_id,
        "score": review.score,
        "comment": review.comment,
        "status": review.status,
        "submitted_at": (
            review.submitted_at.isoformat() if review.submitted_at else None
        ),
    }


@router.post("")
async def submit_assignment(
    body: AssignmentSubmit,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生提交作业。"""
    assignment = Assignment(
        session_id=body.session_id,
        student_id=user.user_id,
        content=body.content,
        file_url=body.file_url,
        status="submitted",
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return {
        "assignment_id": str(assignment.assignment_id),
        "status": assignment.status,
    }


@router.get("/mine")
async def list_my_assignments(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """学生查看自己的作业提交历史。"""
    result = await db.execute(
        select(Assignment)
        .where(Assignment.student_id == user.user_id)
        .order_by(Assignment.created_at.desc())
    )
    assignments = result.scalars().all()
    return [
        {
            "assignment_id": str(a.assignment_id),
            "task_id": a.task_id,
            "session_id": a.session_id,
            "content": a.content,
            "file_url": a.file_url,
            "status": a.status,
            "ai_review": a.ai_review,
            "teacher_review": a.teacher_review,
            "created_at": a.created_at.isoformat(),
        }
        for a in assignments
    ]


@router.get("/by-session/{session_id}")
async def list_by_session(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """按 session 获取作业列表。"""
    result = await db.execute(
        select(Assignment)
        .where(Assignment.session_id == session_id)
        .order_by(Assignment.created_at.desc())
    )
    assignments = result.scalars().all()
    return [
        {
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
        for a in assignments
    ]


@router.post("/{assignment_id}/grade")
async def ai_grade_assignment(
    assignment_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """AI 自动评分。"""
    result = await db.execute(
        select(Assignment).where(Assignment.assignment_id == assignment_id)
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(404, "作业不存在")

    if not assignment.content:
        raise HTTPException(400, "作业内容为空，无法评分")

    try:
        from app.llm.factory import get_llm_client
        from app.llm.prompts import GRADER_PROMPT

        client = get_llm_client("deepseek")
        messages = [
            {"role": "system", "content": GRADER_PROMPT},
            {"role": "user", "content": assignment.content},
        ]

        full_response = ""
        async for chunk in client.stream_chat(messages=messages):
            full_response += chunk

        # 尝试解析 JSON 评分
        try:
            # 清理可能的 markdown 标记
            cleaned = full_response.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1]
            if cleaned.endswith("```"):
                cleaned = cleaned.rsplit("```", 1)[0]
            ai_review = json.loads(cleaned.strip())
        except json.JSONDecodeError:
            ai_review = {
                "raw_response": full_response,
                "scores": {"critical_thinking": 0, "evidence": 0, "logic": 0},
                "total_score": 0,
                "summary": "AI 评分解析失败，请手动评分",
                "suggestions": [],
            }

        assignment.ai_review = ai_review
        assignment.status = "ai_graded"
        await db.commit()

        return {
            "assignment_id": str(assignment.assignment_id),
            "status": assignment.status,
            "ai_review": ai_review,
        }

    except Exception as e:
        logger.exception("AI grading failed: %s", e)
        raise HTTPException(500, f"AI 评分失败: {e}")


@router.patch("/{assignment_id}/review")
async def teacher_review(
    assignment_id: str,
    body: TeacherReview,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师复核评分。"""
    result = await db.execute(
        select(Assignment).where(Assignment.assignment_id == assignment_id)
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(404, "作业不存在")

    assignment.teacher_review = {
        "score": body.score,
        "comment": body.comment,
        "reviewed_by": _teacher.name,
    }
    assignment.status = "reviewed"
    await db.commit()

    return {
        "assignment_id": str(assignment.assignment_id),
        "status": assignment.status,
        "teacher_review": assignment.teacher_review,
    }


@router.patch("/{assignment_id}/ai-score")
async def modify_ai_score(
    assignment_id: str,
    body: TeacherReview,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """教师修改 AI 评分。"""
    result = await db.execute(
        select(Assignment).where(Assignment.assignment_id == assignment_id)
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(404, "作业不存在")

    # 合并更新 AI 评审
    current_review = assignment.ai_review or {}
    if not isinstance(current_review, dict):
        current_review = {}
    if body.score is not None:
        current_review["total_score"] = body.score
    if body.comment is not None:
        current_review["teacher_override_comment"] = body.comment
    assignment.ai_review = current_review
    await db.commit()

    return {
        "assignment_id": str(assignment.assignment_id),
        "status": assignment.status,
        "ai_review": assignment.ai_review,
    }
