"""知识库管理路由 — 文档上传、列表、删除。"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_teacher
from app.models.document import Document
from app.models.user import User
from app.services.knowledge_service import ingest_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/knowledge", tags=["knowledge"])


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
        result = await ingest_document(db, content, file.filename)
        return {"message": "上传成功", **result}
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Document upload failed: %s", e)
        raise HTTPException(500, f"文档处理失败: {e}")


@router.get("/documents")
async def list_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    _teacher: Annotated[User, Depends(require_teacher)],
):
    """列出已上传的文档（按源文件聚合）。"""
    result = await db.execute(
        select(
            Document.source_file,
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
            "chunk_count": d.chunk_count,
            "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
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
