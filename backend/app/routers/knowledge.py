"""知识库管理路由 — 文档上传、列表、删除。"""
from __future__ import annotations

import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_teacher
from app.models.document import Document
from app.models.user import User
from app.services.knowledge_service import ingest_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/knowledge", tags=["knowledge"])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/opt/cothink/uploads")


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _teacher: User = Depends(require_teacher),
):
    """上传 PDF/Docx/TXT → 切片 → 向量入库。"""
    if not file.filename:
        raise HTTPException(400, "文件名不能为空")

    allowed = (".pdf", ".docx", ".doc", ".txt")
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(400, f"仅支持 {', '.join(allowed)} 格式")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(400, "文件大小不能超过 20MB")

    try:
        import os
        import uuid
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        safe_name = f"{uuid.uuid4().hex}_{file.filename}"
        file_path = os.path.join(UPLOAD_DIR, safe_name)
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        file_url = f"/uploads/{safe_name}"
        
        result = await ingest_document(db, content, file.filename, file_url)
        return {"message": "上传成功", "file_url": file_url, **result}
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Document upload failed: %s", e)
        raise HTTPException(500, f"文档处理失败: {e}")


@router.get("/documents")
async def list_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
):
    """列出已上传的文档（按源文件聚合）。开放给所有登录用户。"""
    result = await db.execute(
        select(
            Document.source_file,
            func.max(Document.file_url).label("file_url"),
            func.count().label("chunk_count"),
            func.min(Document.created_at).label("uploaded_at"),
        )
        .outerjoin(Document.chunks) if hasattr(Document, 'chunks') else select(
            Document.source_file,
            func.max(Document.file_url).label("file_url"),
            func.count().label("chunk_count"),
            func.min(Document.created_at).label("uploaded_at"),
        )
        .group_by(Document.source_file)
        .order_by(func.min(Document.created_at).desc())
    )
    docs = result.all()
    return [
        {
            "source_file": d.source_file,
            "file_url": getattr(d, 'file_url', None),
            "chunk_count": getattr(d, 'chunk_count', 0),
            "uploaded_at": d.uploaded_at.isoformat() if hasattr(d, 'uploaded_at') and d.uploaded_at else None,
        }
        for d in docs
    ]


@router.delete("/documents/{source_file}")
async def delete_document(
    source_file: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """删除指定文档的所有切片。"""
    from sqlalchemy import delete as sql_delete

    result = await db.execute(
        sql_delete(Document).where(Document.source_file == source_file)
    )
    await db.commit()
    return {"deleted_chunks": result.rowcount, "source_file": source_file}
