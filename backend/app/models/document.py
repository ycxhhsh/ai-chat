"""文档知识库模型（用于 RAG — pgvector）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Integer, String, Text
import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Document(Base):
    """原始文档记录。"""
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_file: Mapped[str] = mapped_column(
        String, nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class DocumentChunk(Base):
    """文档切片 + pgvector 向量（用于 RAG 检索）。"""
    __tablename__ = "document_chunks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        String(36), nullable=False, index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_file: Mapped[str] = mapped_column(
        String, nullable=False, index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # pgvector 向量列（1024 维，匹配阿里云 text-embedding-v3）
    embedding = mapped_column(
        Vector(1024), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Risk 3: HNSW 索引避免全表顺序扫描
    __table_args__ = (
        sa.Index(
            'ix_document_chunks_embedding_hnsw',
            'embedding',
            postgresql_using='hnsw',
            postgresql_with={'m': 16, 'ef_construction': 64},
            postgresql_ops={'embedding': 'vector_cosine_ops'},
        ),
    )
