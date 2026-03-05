"""课程管理路由 — CRUD + 加入课程。"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_teacher, get_current_user
from app.models.course import Course, CourseEnrollment
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/courses", tags=["courses"])


class CourseCreate(BaseModel):
    name: str
    description: str = ""


class CourseJoin(BaseModel):
    invite_code: str


@router.post("")
async def create_course(
    body: CourseCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(require_teacher)],
):
    """教师创建课程。"""
    course = Course(
        name=body.name,
        description=body.description,
        teacher_id=teacher.user_id,
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return {
        "course_id": course.course_id,
        "name": course.name,
        "invite_code": course.invite_code,
    }


@router.get("")
async def list_courses(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """列出用户相关的课程（教师看自己创建的，学生看已加入的）。"""
    if user.role == "teacher":
        result = await db.execute(
            select(Course).where(Course.teacher_id == user.user_id)
            .order_by(Course.created_at.desc())
        )
        courses = result.scalars().all()
    else:
        result = await db.execute(
            select(Course)
            .join(CourseEnrollment, Course.course_id == CourseEnrollment.course_id)
            .where(CourseEnrollment.user_id == user.user_id)
            .order_by(Course.created_at.desc())
        )
        courses = result.scalars().all()

    return [
        {
            "course_id": c.course_id,
            "name": c.name,
            "description": c.description,
            "invite_code": c.invite_code,
            "teacher_id": c.teacher_id,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in courses
    ]


@router.post("/join")
async def join_course(
    body: CourseJoin,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """通过邀请码加入课程。"""
    result = await db.execute(
        select(Course).where(Course.invite_code == body.invite_code)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "邀请码无效")

    # 检查是否已加入
    existing = await db.execute(
        select(CourseEnrollment).where(
            CourseEnrollment.course_id == course.course_id,
            CourseEnrollment.user_id == user.user_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "已加入该课程", "course_id": course.course_id}

    enrollment = CourseEnrollment(
        course_id=course.course_id,
        user_id=user.user_id,
        role=user.role,
    )
    db.add(enrollment)
    await db.commit()
    return {"message": "加入成功", "course_id": course.course_id}


@router.get("/{course_id}/students")
async def list_course_students(
    course_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """查看课程学生列表。"""
    result = await db.execute(
        select(CourseEnrollment)
        .where(CourseEnrollment.course_id == course_id)
        .order_by(CourseEnrollment.enrolled_at.desc())
    )
    enrollments = result.scalars().all()
    return [
        {
            "user_id": e.user_id,
            "role": e.role,
            "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
        }
        for e in enrollments
    ]
