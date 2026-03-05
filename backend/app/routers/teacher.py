"""教师端数据查询路由 — 含分析、导出功能。"""
from __future__ import annotations

import csv
import io
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, case, literal_column, cast, String as SAString
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_teacher
from app.models.message import Message
from app.models.user import User
from app.models.group import Group, GroupMember
from app.models.assignment import Assignment
from app.models.ai_conversation import AiConversation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/teacher", tags=["teacher"])


# PostgreSQL JSON 提取辅助函数
def _jq(column, *keys):
    """从 JSON 列提取文本值（PostgreSQL 兼容）。

    _jq(Message.sender, 'id') => sender->>'id'
    _jq(Message.metadata_info, 'scaffold_info', 'name') => metadata_info->'scaffold_info'->>'name'
    """
    col = column
    for key in keys[:-1]:
        col = col.op("->")(key)  # -> operator (returns JSON)
    return col.op("->>")((keys[-1]))  # ->> operator (returns text)



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
        q = q.where(_jq(Message.sender, 'id') == user_id)

    result = await db.execute(q.offset(offset).limit(page_size))
    messages = result.scalars().all()

    count_q = select(func.count()).select_from(Message)
    if session_id:
        count_q = count_q.where(Message.session_id == session_id)
    if user_id:
        count_q = count_q.where(_jq(Message.sender, 'id') == user_id)
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
                _jq(Message.sender, 'role') == "ai"
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
                _jq(Message.metadata_info, 'is_scaffold_used') == 'true'  # noqa
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


# ────────────────────── 作业列表 ──────────────────────

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

@router.get("/analytics")
async def get_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """深度分析数据：支架热力图、AI介入率、参与度等。"""

    # 1. 支架使用热力图：每个支架被使用的次数
    scaffold_heatmap = []
    try:
        result = await db.execute(
            select(
                _jq(Message.metadata_info, 'scaffold_info', 'name').label("scaffold_name"),
                func.count().label("usage_count"),
            )
            .where(
                _jq(Message.metadata_info, 'is_scaffold_used') == 'true'  # noqa
            )
            .group_by(_jq(Message.metadata_info, 'scaffold_info', 'name'))
        )
        scaffold_heatmap = [
            {"name": row.scaffold_name, "count": row.usage_count}
            for row in result if row.scaffold_name
        ]
    except Exception as e:
        logger.warning("Scaffold heatmap query failed: %s", e)

    # 2. AI 介入率：每个学生的 AI/总消息比
    ai_intervention_rate = []
    try:
        # 获取每个学生的总发送消息数
        student_msgs = await db.execute(
            select(
                _jq(Message.sender, 'id').label("uid"),
                _jq(Message.sender, 'name').label("uname"),
                func.count().label("total"),
            )
            .where(_jq(Message.sender, 'role') == "student")
            .group_by(_jq(Message.sender, 'id'))
        )
        student_msg_data = {row.uid: {"name": row.uname, "total": row.total} for row in student_msgs}

        # 获取每个学生收到的 AI 回复数（recipient_id == student_id）
        ai_replies = await db.execute(
            select(
                Message.recipient_id.label("uid"),
                func.count().label("ai_count"),
            )
            .where(
                _jq(Message.sender, 'role') == "ai",
                Message.recipient_id.is_not(None),
            )
            .group_by(Message.recipient_id)
        )
        ai_reply_map = {row.uid: row.ai_count for row in ai_replies}

        for uid, data in student_msg_data.items():
            ai_count = ai_reply_map.get(uid, 0)
            total = data["total"] + ai_count
            ai_intervention_rate.append({
                "user_id": uid,
                "name": data["name"],
                "student_messages": data["total"],
                "ai_replies": ai_count,
                "rate": round(ai_count / total * 100, 1) if total > 0 else 0,
            })

        ai_intervention_rate.sort(key=lambda x: x["rate"], reverse=True)
    except Exception as e:
        logger.warning("AI intervention rate query failed: %s", e)

    # 3. 参与度曲线：按小时聚合消息数
    participation_curve = []
    try:
        result = await db.execute(
            select(
                func.to_char(Message.created_at, 'YYYY-MM-DD HH24:00').label("hour"),
                func.count().label("count"),
            )
            .group_by(func.to_char(Message.created_at, 'YYYY-MM-DD HH24:00'))
            .order_by(func.to_char(Message.created_at, 'YYYY-MM-DD HH24:00'))
            .limit(168)  # 最近 7 天按小时
        )
        participation_curve = [
            {"time": row.hour, "count": row.count}
            for row in result
        ]
    except Exception as e:
        logger.warning("Participation curve query failed: %s", e)

    # 4. 讨论深度：消息平均长度（按学生）
    discussion_depth = []
    try:
        result = await db.execute(
            select(
                _jq(Message.sender, 'name').label("name"),
                func.avg(func.length(Message.content)).label("avg_length"),
                func.count().label("msg_count"),
            )
            .where(_jq(Message.sender, 'role') == "student")
            .group_by(_jq(Message.sender, 'id'))
            .order_by(func.avg(func.length(Message.content)).desc())
        )
        discussion_depth = [
            {"name": row.name, "avg_length": round(row.avg_length, 0), "count": row.msg_count}
            for row in result
        ]
    except Exception as e:
        logger.warning("Discussion depth query failed: %s", e)

    # 5. 支架依赖度（全局）
    scaffold_dependency = {"total": 0, "scaffold_used": 0, "rate": 0}
    try:
        total_student_msgs = (
            await db.execute(
                select(func.count()).where(
                    _jq(Message.sender, 'role') == "student"
                )
            )
        ).scalar() or 0

        scaffold_used_msgs = (
            await db.execute(
                select(func.count()).where(
                    _jq(Message.sender, 'role') == "student",
                    _jq(Message.metadata_info, 'is_scaffold_used') == 'true',
                )
            )
        ).scalar() or 0

        scaffold_dependency = {
            "total": total_student_msgs,
            "scaffold_used": scaffold_used_msgs,
            "rate": round(scaffold_used_msgs / total_student_msgs * 100, 1) if total_student_msgs else 0,
        }
    except Exception as e:
        logger.warning("Scaffold dependency query failed: %s", e)

    return {
        "scaffold_heatmap": scaffold_heatmap,
        "ai_intervention_rate": ai_intervention_rate,
        "participation_curve": participation_curve,
        "discussion_depth": discussion_depth,
        "scaffold_dependency": scaffold_dependency,
    }


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


