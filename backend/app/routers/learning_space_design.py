"""学习空间设计 REST API。"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_teacher
from app.models.user import User
from app.services.learning_space_design_service import (
    STAGE_OPTIONS,
    STEP_ORDER,
    adopt_acceleration,
    append_ai_message,
    build_report,
    check_acceleration,
    create_or_update_entry,
    create_question,
    delete_question,
    fetch_session_payload,
    generate_summary,
    get_session_or_404,
    list_progress,
    list_questions,
    list_student_questions,
    serialize_question,
    serialize_session,
    start_session,
    submit_step,
    update_question,
)
from app.services.learning_space_design_summary import generate_learning_space_summary

router = APIRouter(prefix="/learning-space-design", tags=["learning-space-design"])


class QuestionCreate(BaseModel):
    stage_name: str
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    enabled_steps: list[str]
    ai_round_limit: int = Field(default=3, ge=1, le=10)
    min_words_step1: int = Field(default=30, ge=1, le=500)
    min_words_step3: int = Field(default=50, ge=1, le=500)
    min_words_step5: int = Field(default=80, ge=1, le=1000)
    allow_ai_acceleration: bool = False


class QuestionUpdate(BaseModel):
    stage_name: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    enabled_steps: list[str] | None = None
    ai_round_limit: int | None = Field(default=None, ge=1, le=10)
    min_words_step1: int | None = Field(default=None, ge=1, le=500)
    min_words_step3: int | None = Field(default=None, ge=1, le=500)
    min_words_step5: int | None = Field(default=None, ge=1, le=1000)
    allow_ai_acceleration: bool | None = None


class StartSessionRequest(BaseModel):
    group_id: str | None = None


class EntryCreateRequest(BaseModel):
    step_key: str
    content: str


class EntryUpdateRequest(BaseModel):
    content: str


class AiMessageRequest(BaseModel):
    step_key: str
    content: str
    llm_provider: str = "deepseek"


class SubmitStepRequest(BaseModel):
    step_key: str


class AccelerationCheckRequest(BaseModel):
    step_key: str
    content: str
    llm_provider: str = "deepseek"


class AccelerationAdoptRequest(BaseModel):
    check_id: str


class SummaryRequest(BaseModel):
    llm_provider: str = "deepseek"


def ensure_visible_role(user: User, session_student_id: str) -> str:
    if user.role == "teacher":
        return "teacher"
    if user.user_id != session_student_id:
        raise HTTPException(status_code=403, detail="无权访问该学习单")
    return "student"


@router.get("/meta")
async def get_meta():
    return {"stages": STAGE_OPTIONS, "steps": STEP_ORDER}


@router.get("/questions")
async def get_questions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    return [serialize_question(item) for item in await list_questions(db)]


@router.post("/questions")
async def post_question(
    body: QuestionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(require_teacher)],
):
    question = await create_question(db, teacher, body.model_dump())
    return serialize_question(question)


@router.put("/questions/{question_id}")
async def put_question(
    question_id: str,
    body: QuestionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    question = await update_question(
        db, question_id, body.model_dump(exclude_none=True)
    )
    return serialize_question(question)


@router.delete("/questions/{question_id}")
async def remove_question(
    question_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    await delete_question(db, question_id)
    return {"ok": True}


@router.get("/progress")
async def get_progress(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    return await list_progress(db)


@router.get("/student/questions")
async def get_student_questions(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    return await list_student_questions(db, student)


@router.post("/questions/{question_id}/start")
async def post_start_session(
    question_id: str,
    body: StartSessionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    session = await start_session(db, question_id, student, body.group_id)
    return serialize_session(session)


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    session = await get_session_or_404(db, session_id)
    ensure_visible_role(user, session.student_id)
    return await fetch_session_payload(db, session_id)


@router.post("/sessions/{session_id}/entries")
async def post_entry(
    session_id: str,
    body: EntryCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    entry = await create_or_update_entry(
        db, session_id, body.step_key, body.content, student, update_existing=False
    )
    return {"entry": entry.id}


@router.put("/sessions/{session_id}/entries/{entry_id}")
async def put_entry(
    session_id: str,
    entry_id: str,
    body: EntryUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    payload = await fetch_session_payload(db, session_id)
    target = next((item for item in payload["entries"] if item["id"] == entry_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="记录不存在")
    entry = await create_or_update_entry(
        db,
        session_id,
        target["step_key"],
        body.content,
        student,
        update_existing=True,
    )
    return {"entry": entry.id}


@router.post("/sessions/{session_id}/ai-message")
async def post_ai_message(
    session_id: str,
    body: AiMessageRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    return await append_ai_message(
        db, session_id, body.step_key, body.content, student, body.llm_provider
    )


@router.post("/sessions/{session_id}/submit-step")
async def post_submit_step(
    session_id: str,
    body: SubmitStepRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    session = await submit_step(db, session_id, body.step_key, student)
    return serialize_session(session)


@router.post("/sessions/{session_id}/check-acceleration")
async def post_check_acceleration(
    session_id: str,
    body: AccelerationCheckRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    check = await check_acceleration(db, session_id, body.step_key, student, body.model_dump())
    return {"check": check.id}


@router.post("/sessions/{session_id}/adopt-acceleration")
async def post_adopt_acceleration(
    session_id: str,
    body: AccelerationAdoptRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[User, Depends(get_current_user)],
):
    session = await adopt_acceleration(db, session_id, body.check_id, student)
    return serialize_session(session)


@router.post("/sessions/{session_id}/generate-summary")
async def post_generate_summary(
    session_id: str,
    body: SummaryRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    session = await get_session_or_404(db, session_id)
    ensure_visible_role(user, session.student_id)
    if session.status != "completed":
        raise HTTPException(status_code=400, detail="学习单完成后才能生成正式摘要")
    summary = await generate_learning_space_summary(db, session_id, body.llm_provider)
    updated = await generate_summary(db, session_id, summary)
    return {"summary": updated.summary}


@router.get("/sessions/{session_id}/report")
async def get_report(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    session = await get_session_or_404(db, session_id)
    viewer_role = ensure_visible_role(user, session.student_id)
    return await build_report(db, session_id, viewer_role=viewer_role)


@router.get("/sessions/{session_id}/export")
async def get_export(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    session = await get_session_or_404(db, session_id)
    viewer_role = ensure_visible_role(user, session.student_id)
    return await build_report(db, session_id, viewer_role=viewer_role)
