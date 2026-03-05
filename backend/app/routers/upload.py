"""通用文件上传端点 — 用于作业附件等。"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.dependencies import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["upload"])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/opt/cothink/uploads")
MAX_SIZE = 20 * 1024 * 1024  # 20MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg", ".gif"}


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    _user: Annotated[User, Depends(get_current_user)] = None,  # type: ignore[assignment]
):
    """上传文件，返回可访问的 URL。"""
    if not file.filename:
        raise HTTPException(400, "文件名不能为空")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"不支持的文件格式 '{ext}'，仅允许: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, f"文件大小不能超过 {MAX_SIZE // (1024 * 1024)}MB")

    # 确保上传目录存在
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # 防冲突文件名
    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(file_path, "wb") as f:
        f.write(content)

    logger.info("File uploaded: %s -> %s by user %s", file.filename, safe_name, _user.user_id)

    return {
        "file_url": f"/uploads/{safe_name}",
        "original_name": file.filename,
    }
