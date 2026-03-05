"""作业相关路由 — 提交、AI 评分、教师复核。"""
from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_teacher
from app.models.assignment import Assignment
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assignments", tags=["assignments"])


class AssignmentSubmit(BaseModel):
    session_id: str = "assignment"
    content: str
    file_url: str | None = None


class TeacherReview(BaseModel):
    score: int | None = None
    comment: str | None = None


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
