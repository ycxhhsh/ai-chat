"""学生名单 XLSX 导入路由。"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_teacher
from app.core.security import hash_password
from app.models.user import User
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/roster", tags=["roster"])


class AddStudentRequest(BaseModel):
    name: str
    student_id: str


@router.post("/add-one")
async def add_one_student(
    body: AddStudentRequest,
    db: AsyncSession = Depends(get_db),
    _teacher: User = Depends(require_teacher),
):
    """教师手动添加单个学生账号。

    - email = {student_id}@stu.edu
    - 默认密码 = 123456
    - 若学号已存在返回 409
    """
    name = body.name.strip()
    sid = body.student_id.strip()

    if not name or not sid:
        raise HTTPException(status_code=400, detail="姓名和学号不能为空")

    email = f"{sid}@stu.edu"

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"学号 {sid} 已存在")

    user = User(
        email=email,
        password_hash=hash_password("123456"),
        name=name,
        role="student",
    )
    db.add(user)
    await db.commit()

    return {"message": f"学生 {name}({sid}) 创建成功", "email": email}



@router.post("/import")
async def import_students(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _teacher: User = Depends(require_teacher),
):
    """从 XLSX 批量创建学生账号。

    XLSX 格式要求：
    - 第一行为表头
    - 必须包含列：学号/工号, 姓名
    - 可选列：专业
    会自动将 学号@stu.edu 设为邮箱，并默认密码为 123456。
    """
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="请上传 .xlsx 文件")

    try:
        import openpyxl
        from io import BytesIO

        content = await file.read()
        wb = openpyxl.load_workbook(BytesIO(content), read_only=True)
        ws = wb.active
        if not ws:
            raise HTTPException(status_code=400, detail="工作表为空")

        rows = list(ws.iter_rows(values_only=True))
        if len(rows) < 2:
            raise HTTPException(status_code=400, detail="文件中没有数据行")

        # 解析表头
        header = [str(h).strip().lower() if h else "" for h in rows[0]]
        sid_col = _find_col(header, ["学号", "工号"])
        name_col = _find_col(header, ["姓名", "名字", "name"])
        major_col = _find_col(header, ["专业", "major"])

        if sid_col < 0 or name_col < 0:
            raise HTTPException(
                status_code=400,
                detail="表头须包含「学号/工号」和「姓名」列",
            )

        created, skipped, errors = 0, 0, []
        default_pwd_hash = hash_password("123456")

        for i, row in enumerate(rows[1:], start=2):
            try:
                sid = str(row[sid_col]).strip() if row[sid_col] else ""
                name = str(row[name_col]).strip() if row[name_col] else ""
                
                if not sid or not name:
                    errors.append(f"第{i}行：学号或姓名为空")
                    continue

                email = f"{sid}@stu.edu"

                # 检查是否已存在
                existing = await db.execute(
                    select(User).where(User.email == email)
                )
                if existing.scalar_one_or_none():
                    skipped += 1
                    continue

                user = User(
                    email=email,
                    password_hash=default_pwd_hash,
                    name=name,
                    role="student",
                )
                db.add(user)
                created += 1
            except Exception as e:
                errors.append(f"第{i}行：{e}")

        await db.commit()
        wb.close()

        return {
            "created": created,
            "skipped": skipped,
            "errors": errors,
            "total_rows": len(rows) - 1,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Roster import failed: %s", e)
        raise HTTPException(status_code=500, detail=f"导入失败: {e}")


def _find_col(header: list[str], candidates: list[str]) -> int:
    """在表头中查找匹配的列索引。"""
    for i, h in enumerate(header):
        for c in candidates:
            if c in h:
                return i
    return -1
