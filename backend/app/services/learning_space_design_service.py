"""学习空间设计业务服务。"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.factory import get_llm_client
from app.llm.prompts import (
    LEARNING_SPACE_DESIGN_ACCELERATION_PROMPT,
    LEARNING_SPACE_DESIGN_CHAT_PROMPT,
)
from app.models.learning_space_design import (
    LearningSpaceAccelerationCheck,
    LearningSpaceEntry,
    LearningSpaceMessage,
    LearningSpaceQuestion,
    LearningSpaceRevision,
    LearningSpaceSession,
)
from app.models.user import User

STAGE_OPTIONS = [
    "入项与启动",
    "规划与构建",
    "探究与创作",
    "展示与评价",
]

STEP_ORDER = [
    "self_think",
    "ai_question",
    "verify",
    "challenge",
    "integrate",
]

TEXT_STEPS = {"self_think", "verify", "integrate"}
AI_STEPS = {"ai_question", "challenge"}
REQUIRED_STEPS = {"self_think", "integrate"}
DEFAULT_ROUND_LIMIT = 3
DEFAULT_WORD_LIMITS = {
    "self_think": 30,
    "verify": 50,
    "integrate": 80,
}

STEP_LABELS = {
    "self_think": "自主思考",
    "ai_question": "对话提问",
    "verify": "获取验证",
    "challenge": "追问/反驳",
    "integrate": "深化整合",
}

STEP_GOALS = {
    "self_think": "学生先形成自己的初始判断、依据和困惑，避免直接依赖 AI 给答案。",
    "ai_question": "学生向 AI 提出澄清性、比较性或漏洞发现问题，推动初始想法具体化。",
    "verify": "学生补充可验证证据、资料来源、用户反馈或案例，检验前一步想法。",
    "challenge": "学生追问、反驳或要求 AI 从反方视角挑战方案，暴露边界条件。",
    "integrate": "学生整合自主想法、AI 对话、验证证据和反驳回应，形成最终观点。",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def compact_len(text: str) -> int:
    return len(re.sub(r"\s+", "", text or ""))


def normalize_enabled_steps(steps: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for step in STEP_ORDER:
        if step in steps and step not in seen:
            normalized.append(step)
            seen.add(step)
    if not REQUIRED_STEPS.issubset(set(normalized)):
        raise HTTPException(
            status_code=400,
            detail="self_think 和 integrate 为必选步骤",
        )
    return normalized


def ensure_stage(stage_name: str) -> None:
    if stage_name not in STAGE_OPTIONS:
        raise HTTPException(status_code=400, detail="无效的项目阶段")


def ensure_step_enabled(question: LearningSpaceQuestion, step_key: str) -> None:
    if step_key not in question.enabled_steps:
        raise HTTPException(status_code=400, detail="该步骤未启用")


def get_min_words(question: LearningSpaceQuestion, step_key: str) -> int:
    if step_key == "self_think":
        return question.min_words_step1
    if step_key == "verify":
        return question.min_words_step3
    if step_key == "integrate":
        return question.min_words_step5
    return 0


def get_next_step(question: LearningSpaceQuestion, step_key: str) -> str | None:
    enabled = question.enabled_steps
    if step_key not in enabled:
        return None
    idx = enabled.index(step_key)
    if idx >= len(enabled) - 1:
        return None
    return enabled[idx + 1]


def is_forward_step(question: LearningSpaceQuestion, current_step: str, target_step: str) -> bool:
    enabled = question.enabled_steps
    if current_step not in enabled or target_step not in enabled:
        return False
    return enabled.index(target_step) > enabled.index(current_step)


def assert_student_owns_session(session: LearningSpaceSession, user: User) -> None:
    if session.student_id != user.user_id:
        raise HTTPException(status_code=403, detail="无权访问该学习单")


def extract_json_payload(raw_text: str) -> dict[str, Any]:
    cleaned = raw_text.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise HTTPException(status_code=500, detail="AI 返回格式异常")
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail="AI 返回 JSON 解析失败") from exc


def format_learning_context(
    question: LearningSpaceQuestion,
    entries: list[LearningSpaceEntry],
    messages: list[LearningSpaceMessage],
    current_step: str,
) -> str:
    current_index = (
        question.enabled_steps.index(current_step)
        if current_step in question.enabled_steps
        else 0
    )
    entry_lines = []
    for entry in entries:
        label = STEP_LABELS.get(entry.step_key, entry.step_key)
        entry_lines.append(f"- {label}：{entry.content}")

    previous_messages = [
        message
        for message in messages
        if message.step_key in question.enabled_steps
        and question.enabled_steps.index(message.step_key) < current_index
    ][-10:]
    previous_message_lines = []
    for message in previous_messages:
        label = STEP_LABELS.get(message.step_key, message.step_key)
        role = "学生" if message.role == "user" else "AI"
        previous_message_lines.append(
            f"- {label} / {role}第{message.round_index}轮：{message.content}"
        )

    same_step_messages = [
        message for message in messages if message.step_key == current_step
    ][-6:]
    message_lines = []
    for message in same_step_messages:
        role = "学生" if message.role == "user" else "AI"
        message_lines.append(f"- {role}第{message.round_index}轮：{message.content}")

    return (
        f"子问题描述：{question.description or '无'}\n"
        f"当前步骤目标：{STEP_GOALS.get(current_step, '')}\n"
        f"已完成文本记录：\n{chr(10).join(entry_lines) if entry_lines else '暂无'}\n"
        f"跨阶段对话线索：\n{chr(10).join(previous_message_lines) if previous_message_lines else '暂无'}\n"
        f"当前步骤历史对话：\n{chr(10).join(message_lines) if message_lines else '暂无'}"
    )


@dataclass
class SessionBundle:
    question: LearningSpaceQuestion
    session: LearningSpaceSession


async def get_question_or_404(
    db: AsyncSession,
    question_id: str,
) -> LearningSpaceQuestion:
    question = await db.get(LearningSpaceQuestion, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="子问题不存在")
    return question


async def get_session_or_404(
    db: AsyncSession,
    session_id: str,
) -> LearningSpaceSession:
    session = await db.get(LearningSpaceSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="学习单不存在")
    return session


async def get_session_bundle(
    db: AsyncSession,
    session_id: str,
) -> SessionBundle:
    session = await get_session_or_404(db, session_id)
    question = await get_question_or_404(db, session.question_id)
    return SessionBundle(question=question, session=session)


async def list_questions(db: AsyncSession) -> list[LearningSpaceQuestion]:
    result = await db.execute(
        select(LearningSpaceQuestion).order_by(
            LearningSpaceQuestion.stage_name.asc(),
            LearningSpaceQuestion.created_at.desc(),
        )
    )
    return list(result.scalars().all())


async def create_question(
    db: AsyncSession,
    teacher: User,
    payload: dict[str, Any],
) -> LearningSpaceQuestion:
    ensure_stage(payload["stage_name"])
    enabled_steps = normalize_enabled_steps(payload["enabled_steps"])
    question = LearningSpaceQuestion(
        stage_name=payload["stage_name"],
        title=payload["title"].strip(),
        description=(payload.get("description") or "").strip() or None,
        enabled_steps=enabled_steps,
        ai_round_limit=payload.get("ai_round_limit", DEFAULT_ROUND_LIMIT),
        min_words_step1=payload.get(
            "min_words_step1", DEFAULT_WORD_LIMITS["self_think"]
        ),
        min_words_step3=payload.get(
            "min_words_step3", DEFAULT_WORD_LIMITS["verify"]
        ),
        min_words_step5=payload.get(
            "min_words_step5", DEFAULT_WORD_LIMITS["integrate"]
        ),
        allow_ai_acceleration=payload.get("allow_ai_acceleration", False),
        created_by=teacher.user_id,
    )
    db.add(question)
    await db.commit()
    await db.refresh(question)
    return question


async def update_question(
    db: AsyncSession,
    question_id: str,
    payload: dict[str, Any],
) -> LearningSpaceQuestion:
    question = await get_question_or_404(db, question_id)
    if "stage_name" in payload:
        ensure_stage(payload["stage_name"])
        question.stage_name = payload["stage_name"]
    if "title" in payload:
        question.title = payload["title"].strip()
    if "description" in payload:
        question.description = (payload["description"] or "").strip() or None
    if "enabled_steps" in payload:
        question.enabled_steps = normalize_enabled_steps(payload["enabled_steps"])
    for field in (
        "ai_round_limit",
        "min_words_step1",
        "min_words_step3",
        "min_words_step5",
        "allow_ai_acceleration",
    ):
        if field in payload:
            setattr(question, field, payload[field])
    question.updated_at = utcnow()
    await db.commit()
    await db.refresh(question)
    return question


async def delete_question(db: AsyncSession, question_id: str) -> None:
    question = await get_question_or_404(db, question_id)
    session_exists = await db.scalar(
        select(LearningSpaceSession.id)
        .where(LearningSpaceSession.question_id == question_id)
        .limit(1)
    )
    if session_exists:
        raise HTTPException(
            status_code=409,
            detail="已有学生学习记录，不能删除该子问题",
        )
    await db.delete(question)
    await db.commit()


async def list_student_questions(
    db: AsyncSession,
    student: User,
) -> list[dict[str, Any]]:
    result = await db.execute(
        select(LearningSpaceQuestion, LearningSpaceSession)
        .outerjoin(
            LearningSpaceSession,
            (LearningSpaceSession.question_id == LearningSpaceQuestion.id)
            & (LearningSpaceSession.student_id == student.user_id),
        )
        .order_by(
            LearningSpaceQuestion.stage_name.asc(),
            LearningSpaceQuestion.created_at.desc(),
        )
    )
    rows = result.all()
    return [
        {
            "question": serialize_question(question),
            "session": serialize_session_summary(session) if session else None,
        }
        for question, session in rows
    ]


async def start_session(
    db: AsyncSession,
    question_id: str,
    student: User,
    group_id: str | None = None,
) -> LearningSpaceSession:
    question = await get_question_or_404(db, question_id)
    result = await db.execute(
        select(LearningSpaceSession).where(
            LearningSpaceSession.question_id == question.id,
            LearningSpaceSession.student_id == student.user_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    first_step = question.enabled_steps[0]
    session = LearningSpaceSession(
        question_id=question.id,
        student_id=student.user_id,
        group_id=group_id,
        current_step=first_step,
        current_step_index=0,
        status="in_progress",
        used_acceleration=False,
        last_activity_at=utcnow(),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def get_entry_by_step(
    db: AsyncSession,
    session_id: str,
    step_key: str,
) -> LearningSpaceEntry | None:
    result = await db.execute(
        select(LearningSpaceEntry).where(
            LearningSpaceEntry.session_id == session_id,
            LearningSpaceEntry.step_key == step_key,
        )
    )
    return result.scalar_one_or_none()


async def create_or_update_entry(
    db: AsyncSession,
    session_id: str,
    step_key: str,
    content: str,
    user: User,
    *,
    update_existing: bool = False,
) -> LearningSpaceEntry:
    bundle = await get_session_bundle(db, session_id)
    assert_student_owns_session(bundle.session, user)
    ensure_step_enabled(bundle.question, step_key)
    if step_key not in TEXT_STEPS:
        raise HTTPException(status_code=400, detail="该步骤不是文本填写步骤")

    content = content.strip()
    min_words = get_min_words(bundle.question, step_key)
    if compact_len(content) < min_words:
        raise HTTPException(
            status_code=400,
            detail=f"{STEP_LABELS[step_key]} 至少需要 {min_words} 字",
        )

    entry = await get_entry_by_step(db, session_id, step_key)
    if entry and not update_existing:
        raise HTTPException(status_code=409, detail="该步骤内容已存在")

    now = utcnow()
    if entry:
        revision = LearningSpaceRevision(
            entry_id=entry.id,
            old_content=entry.content,
            new_content=content,
            edited_by=user.user_id,
            edited_at=now,
        )
        db.add(revision)
        entry.content = content
        entry.version += 1
        entry.updated_at = now
    else:
        entry = LearningSpaceEntry(
            session_id=session_id,
            step_key=step_key,
            content=content,
            version=1,
        )
        db.add(entry)
    bundle.session.updated_at = now
    bundle.session.last_activity_at = now
    await db.commit()
    await db.refresh(entry)
    return entry


async def append_ai_message(
    db: AsyncSession,
    session_id: str,
    step_key: str,
    content: str,
    user: User,
    llm_provider: str,
) -> dict[str, Any]:
    bundle = await get_session_bundle(db, session_id)
    assert_student_owns_session(bundle.session, user)
    ensure_step_enabled(bundle.question, step_key)
    if step_key not in AI_STEPS:
        raise HTTPException(status_code=400, detail="该步骤不支持 AI 对话")

    user_message_count = await db.execute(
        select(func.count())
        .select_from(LearningSpaceMessage)
        .where(
            LearningSpaceMessage.session_id == session_id,
            LearningSpaceMessage.step_key == step_key,
            LearningSpaceMessage.role == "user",
        )
    )
    sent_rounds = user_message_count.scalar() or 0
    if sent_rounds >= bundle.question.ai_round_limit:
        raise HTTPException(status_code=400, detail="已达到该步骤的 AI 对话轮数上限")

    content = content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    round_index = sent_rounds + 1
    user_msg = LearningSpaceMessage(
        session_id=session_id,
        step_key=step_key,
        role="user",
        content=content,
        round_index=round_index,
    )
    db.add(user_msg)

    entries_result = await db.execute(
        select(LearningSpaceEntry)
        .where(LearningSpaceEntry.session_id == session_id)
        .order_by(LearningSpaceEntry.created_at.asc())
    )
    messages_result = await db.execute(
        select(LearningSpaceMessage)
        .where(LearningSpaceMessage.session_id == session_id)
        .order_by(LearningSpaceMessage.created_at.asc())
    )
    learning_context = format_learning_context(
        bundle.question,
        list(entries_result.scalars().all()),
        list(messages_result.scalars().all()),
        step_key,
    )

    messages = [
        {"role": "system", "content": LEARNING_SPACE_DESIGN_CHAT_PROMPT},
        {
            "role": "user",
            "content": (
                f"项目阶段：{bundle.question.stage_name}\n"
                f"子问题：{bundle.question.title}\n"
                f"{learning_context}\n"
                f"步骤：{STEP_LABELS[step_key]} ({step_key})\n"
                f"学生消息：{content}"
            ),
        },
    ]
    client = get_llm_client(llm_provider)
    ai_content = await client.chat(messages=messages, temperature=0.6)
    ai_msg = LearningSpaceMessage(
        session_id=session_id,
        step_key=step_key,
        role="assistant",
        content=ai_content.strip(),
        round_index=round_index,
    )
    db.add(ai_msg)
    bundle.session.updated_at = utcnow()
    bundle.session.last_activity_at = bundle.session.updated_at
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(ai_msg)
    return {
        "user_message": serialize_message(user_msg),
        "ai_message": serialize_message(ai_msg),
    }


async def submit_step(
    db: AsyncSession,
    session_id: str,
    step_key: str,
    user: User,
) -> LearningSpaceSession:
    bundle = await get_session_bundle(db, session_id)
    assert_student_owns_session(bundle.session, user)
    ensure_step_enabled(bundle.question, step_key)
    if bundle.session.current_step != step_key:
        raise HTTPException(status_code=400, detail="请按步骤顺序推进")

    if step_key in TEXT_STEPS:
        entry = await get_entry_by_step(db, session_id, step_key)
        if not entry:
            raise HTTPException(status_code=400, detail="请先填写当前步骤内容")
        min_words = get_min_words(bundle.question, step_key)
        if compact_len(entry.content) < min_words:
            raise HTTPException(
                status_code=400,
                detail=f"{STEP_LABELS[step_key]} 至少需要 {min_words} 字",
            )
    else:
        result = await db.execute(
            select(func.count())
            .select_from(LearningSpaceMessage)
            .where(
                LearningSpaceMessage.session_id == session_id,
                LearningSpaceMessage.step_key == step_key,
                LearningSpaceMessage.role == "user",
            )
        )
        rounds = result.scalar() or 0
        if rounds <= 0:
            raise HTTPException(status_code=400, detail="请先完成至少一轮 AI 对话")

    next_step = get_next_step(bundle.question, step_key)
    now = utcnow()
    if next_step is None:
        bundle.session.status = "completed"
        bundle.session.completed_at = now
        bundle.session.current_step = step_key
        bundle.session.current_step_index = len(bundle.question.enabled_steps) - 1
    else:
        bundle.session.current_step = next_step
        bundle.session.current_step_index = bundle.question.enabled_steps.index(next_step)
    bundle.session.updated_at = now
    bundle.session.last_activity_at = now
    await db.commit()
    await db.refresh(bundle.session)
    return bundle.session


async def check_acceleration(
    db: AsyncSession,
    session_id: str,
    step_key: str,
    user: User,
    payload: dict[str, Any],
) -> LearningSpaceAccelerationCheck:
    bundle = await get_session_bundle(db, session_id)
    assert_student_owns_session(bundle.session, user)
    if not bundle.question.allow_ai_acceleration:
        raise HTTPException(status_code=400, detail="当前子问题未启用 AI 加速判断")
    ensure_step_enabled(bundle.question, step_key)

    content = (payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="缺少待判断内容")

    llm_provider = payload.get("llm_provider") or "deepseek"
    next_step = get_next_step(bundle.question, step_key)
    client = get_llm_client(llm_provider)
    raw = await client.chat(
        messages=[
            {"role": "system", "content": LEARNING_SPACE_DESIGN_ACCELERATION_PROMPT},
            {
                "role": "user",
                "content": (
                    f"项目阶段：{bundle.question.stage_name}\n"
                    f"子问题：{bundle.question.title}\n"
                    f"当前步骤：{step_key}\n"
                    f"默认下一步：{next_step}\n"
                    f"学生内容：\n{content}"
                ),
            },
        ],
        temperature=0.2,
    )
    parsed = extract_json_payload(raw)
    suggested = parsed.get("suggested_next_step")
    if suggested and not is_forward_step(bundle.question, step_key, suggested):
        suggested = None
    allowed = bool(parsed.get("allowed")) and suggested is not None
    record = LearningSpaceAccelerationCheck(
        session_id=session_id,
        step_key=step_key,
        allowed=allowed,
        reason=str(parsed.get("reason") or "").strip() or "AI 未给出明确原因",
        suggested_next_step=suggested,
        adopted=False,
    )
    db.add(record)
    bundle.session.updated_at = utcnow()
    bundle.session.last_activity_at = bundle.session.updated_at
    await db.commit()
    await db.refresh(record)
    return record


async def adopt_acceleration(
    db: AsyncSession,
    session_id: str,
    check_id: str,
    user: User,
) -> LearningSpaceSession:
    bundle = await get_session_bundle(db, session_id)
    assert_student_owns_session(bundle.session, user)
    check = await db.get(LearningSpaceAccelerationCheck, check_id)
    if not check or check.session_id != session_id:
        raise HTTPException(status_code=404, detail="加速记录不存在")
    if not check.allowed or not check.suggested_next_step:
        raise HTTPException(status_code=400, detail="该记录不可用于加速跳转")
    if not is_forward_step(bundle.question, bundle.session.current_step, check.suggested_next_step):
        raise HTTPException(status_code=400, detail="加速建议只能跳转到当前步骤之后")

    check.adopted = True
    bundle.session.used_acceleration = True
    bundle.session.current_step = check.suggested_next_step
    bundle.session.current_step_index = bundle.question.enabled_steps.index(
        check.suggested_next_step
    )
    bundle.session.updated_at = utcnow()
    bundle.session.last_activity_at = bundle.session.updated_at
    await db.commit()
    await db.refresh(bundle.session)
    return bundle.session


async def generate_summary(
    db: AsyncSession,
    session_id: str,
    text: str,
) -> LearningSpaceSession:
    session = await get_session_or_404(db, session_id)
    session.summary = text.strip()
    session.updated_at = utcnow()
    await db.commit()
    await db.refresh(session)
    return session


def build_step_completion(
    question: LearningSpaceQuestion,
    session: LearningSpaceSession,
    entries: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    entries_by_step = {entry["step_key"]: entry for entry in entries}
    user_rounds_by_step: dict[str, int] = {}
    for message in messages:
        if message["role"] == "user":
            user_rounds_by_step[message["step_key"]] = (
                user_rounds_by_step.get(message["step_key"], 0) + 1
            )

    completion = []
    for index, step_key in enumerate(question.enabled_steps):
        entry = entries_by_step.get(step_key)
        word_count = compact_len(entry["content"]) if entry else 0
        ai_rounds_used = user_rounds_by_step.get(step_key, 0)
        min_words = get_min_words(question, step_key)
        is_done = (
            index < session.current_step_index
            or session.status == "completed"
            or (step_key in TEXT_STEPS and word_count >= min_words)
            or (step_key in AI_STEPS and ai_rounds_used > 0)
        )
        quality_flags = []
        if step_key in TEXT_STEPS and word_count < min_words:
            quality_flags.append(f"少于{min_words}字")
        if step_key in AI_STEPS and ai_rounds_used == 0:
            quality_flags.append("尚未对话")
        completion.append(
            {
                "step_key": step_key,
                "label": STEP_LABELS[step_key],
                "type": "text" if step_key in TEXT_STEPS else "ai",
                "done": is_done,
                "word_count": word_count,
                "min_words": min_words,
                "ai_rounds_used": ai_rounds_used,
                "ai_round_limit": question.ai_round_limit if step_key in AI_STEPS else 0,
                "quality_flags": quality_flags,
            }
        )
    return completion


async def list_progress(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        select(LearningSpaceSession, LearningSpaceQuestion, User)
        .join(
            LearningSpaceQuestion,
            LearningSpaceQuestion.id == LearningSpaceSession.question_id,
        )
        .join(User, User.user_id == LearningSpaceSession.student_id)
        .order_by(LearningSpaceSession.last_activity_at.desc())
    )
    rows = result.all()
    items: list[dict[str, Any]] = []
    for session, question, student in rows:
        total_steps = len(question.enabled_steps)
        entries_result = await db.execute(
            select(LearningSpaceEntry).where(LearningSpaceEntry.session_id == session.id)
        )
        messages_result = await db.execute(
            select(LearningSpaceMessage).where(LearningSpaceMessage.session_id == session.id)
        )
        entries = [serialize_entry(item) for item in entries_result.scalars().all()]
        messages = [serialize_message(item) for item in messages_result.scalars().all()]
        step_completion = build_step_completion(question, session, entries, messages)
        ai_rounds_used = sum(item["ai_rounds_used"] for item in step_completion)
        word_count = sum(item["word_count"] for item in step_completion)
        items.append(
            {
                "session_id": session.id,
                "student_id": student.user_id,
                "student_name": student.name,
                "stage_name": question.stage_name,
                "question_title": question.title,
                "current_step": session.current_step,
                "current_step_label": STEP_LABELS.get(session.current_step, session.current_step),
                "progress_percent": round(
                    ((session.current_step_index + (1 if session.status == "completed" else 0)) / total_steps) * 100,
                    1,
                ),
                "status": session.status,
                "used_acceleration": session.used_acceleration,
                "word_count": word_count,
                "ai_rounds_used": ai_rounds_used,
                "step_completion": step_completion,
                "updated_at": session.updated_at.isoformat(),
            }
        )
    return items


async def fetch_session_payload(
    db: AsyncSession,
    session_id: str,
) -> dict[str, Any]:
    bundle = await get_session_bundle(db, session_id)
    entries = await db.execute(
        select(LearningSpaceEntry).where(LearningSpaceEntry.session_id == session_id)
    )
    messages = await db.execute(
        select(LearningSpaceMessage)
        .where(LearningSpaceMessage.session_id == session_id)
        .order_by(LearningSpaceMessage.created_at.asc())
    )
    checks = await db.execute(
        select(LearningSpaceAccelerationCheck)
        .where(LearningSpaceAccelerationCheck.session_id == session_id)
        .order_by(LearningSpaceAccelerationCheck.created_at.asc())
    )
    revisions = await db.execute(
        select(LearningSpaceRevision)
        .join(LearningSpaceEntry, LearningSpaceEntry.id == LearningSpaceRevision.entry_id)
        .where(LearningSpaceEntry.session_id == session_id)
        .order_by(LearningSpaceRevision.edited_at.desc())
    )
    serialized_entries = [serialize_entry(item) for item in entries.scalars().all()]
    serialized_messages = [serialize_message(item) for item in messages.scalars().all()]
    return {
        "question": serialize_question(bundle.question),
        "session": serialize_session(bundle.session),
        "entries": serialized_entries,
        "messages": serialized_messages,
        "acceleration_checks": [
            serialize_acceleration_check(item) for item in checks.scalars().all()
        ],
        "revisions": [serialize_revision(item) for item in revisions.scalars().all()],
        "step_completion": build_step_completion(
            bundle.question,
            bundle.session,
            serialized_entries,
            serialized_messages,
        ),
    }


async def build_report(
    db: AsyncSession,
    session_id: str,
    *,
    viewer_role: str,
) -> dict[str, Any]:
    bundle = await get_session_bundle(db, session_id)
    student = await db.get(User, bundle.session.student_id)
    payload = await fetch_session_payload(db, session_id)

    entries_by_step = {item["step_key"]: item for item in payload["entries"]}
    messages_by_step: dict[str, list[dict[str, Any]]] = {step: [] for step in AI_STEPS}
    for message in payload["messages"]:
        messages_by_step.setdefault(message["step_key"], []).append(message)

    revisions_by_entry: dict[str, list[dict[str, Any]]] = {}
    for revision in payload["revisions"]:
        revisions_by_entry.setdefault(revision["entry_id"], []).append(revision)

    steps_report: list[dict[str, Any]] = []
    for step_key in bundle.question.enabled_steps:
        step_payload: dict[str, Any] = {
            "step_key": step_key,
            "label": STEP_LABELS[step_key],
            "type": "text" if step_key in TEXT_STEPS else "ai",
        }
        if step_key in TEXT_STEPS:
            entry = entries_by_step.get(step_key)
            step_payload["final_content"] = entry["content"] if entry else ""
            step_payload["entry"] = entry
            if viewer_role == "teacher" and entry:
                step_payload["revisions"] = revisions_by_entry.get(entry["id"], [])
        else:
            step_payload["messages"] = messages_by_step.get(step_key, [])
        steps_report.append(step_payload)

    return {
        "summary": bundle.session.summary,
        "basic_info": {
            "student_name": student.name if student else "",
            "stage_name": bundle.question.stage_name,
            "question_title": bundle.question.title,
            "enabled_steps": bundle.question.enabled_steps,
            "status": bundle.session.status,
            "used_acceleration": bundle.session.used_acceleration,
            "completed_at": (
                bundle.session.completed_at.isoformat()
                if bundle.session.completed_at
                else None
            ),
        },
        "question": serialize_question(bundle.question),
        "session": serialize_session(bundle.session),
        "steps": steps_report,
        "step_completion": build_step_completion(
            bundle.question,
            bundle.session,
            payload["entries"],
            payload["messages"],
        ),
        "acceleration_checks": payload["acceleration_checks"],
    }


def serialize_question(question: LearningSpaceQuestion) -> dict[str, Any]:
    return {
        "id": question.id,
        "stage_name": question.stage_name,
        "title": question.title,
        "description": question.description,
        "enabled_steps": question.enabled_steps,
        "ai_round_limit": question.ai_round_limit,
        "min_words_step1": question.min_words_step1,
        "min_words_step3": question.min_words_step3,
        "min_words_step5": question.min_words_step5,
        "allow_ai_acceleration": question.allow_ai_acceleration,
        "created_by": question.created_by,
        "created_at": question.created_at.isoformat(),
        "updated_at": question.updated_at.isoformat(),
    }


def serialize_session_summary(session: LearningSpaceSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "current_step": session.current_step,
        "current_step_index": session.current_step_index,
        "status": session.status,
        "used_acceleration": session.used_acceleration,
        "updated_at": session.updated_at.isoformat(),
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
    }


def serialize_session(session: LearningSpaceSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "question_id": session.question_id,
        "student_id": session.student_id,
        "group_id": session.group_id,
        "current_step": session.current_step,
        "current_step_index": session.current_step_index,
        "status": session.status,
        "used_acceleration": session.used_acceleration,
        "summary": session.summary,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        "last_activity_at": session.last_activity_at.isoformat(),
    }


def serialize_entry(entry: LearningSpaceEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "session_id": entry.session_id,
        "step_key": entry.step_key,
        "content": entry.content,
        "version": entry.version,
        "created_at": entry.created_at.isoformat(),
        "updated_at": entry.updated_at.isoformat(),
    }


def serialize_revision(revision: LearningSpaceRevision) -> dict[str, Any]:
    return {
        "id": revision.id,
        "entry_id": revision.entry_id,
        "old_content": revision.old_content,
        "new_content": revision.new_content,
        "edited_by": revision.edited_by,
        "edited_at": revision.edited_at.isoformat(),
    }


def serialize_message(message: LearningSpaceMessage) -> dict[str, Any]:
    return {
        "id": message.id,
        "session_id": message.session_id,
        "step_key": message.step_key,
        "role": message.role,
        "content": message.content,
        "round_index": message.round_index,
        "created_at": message.created_at.isoformat(),
    }


def serialize_acceleration_check(check: LearningSpaceAccelerationCheck) -> dict[str, Any]:
    return {
        "id": check.id,
        "session_id": check.session_id,
        "step_key": check.step_key,
        "allowed": check.allowed,
        "reason": check.reason,
        "suggested_next_step": check.suggested_next_step,
        "adopted": check.adopted,
        "created_at": check.created_at.isoformat(),
    }
