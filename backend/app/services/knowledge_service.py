"""RAG 知识库服务 — pgvector 向量检索。

文档流程：PDF/Word 上传 → 文本提取 → 切片 → Embedding → 入库
检索流程：query embedding → pgvector SQL `<=>` 余弦距离 → top-k 返回
"""
from __future__ import annotations

import logging
import uuid
from io import BytesIO
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentChunk

logger = logging.getLogger(__name__)

# chunk 大小
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


def extract_text(content: bytes, filename: str) -> str:
    """从 PDF/Docx/TXT 文件提取纯文本。"""
    lower = filename.lower()

    if lower.endswith(".pdf"):
        try:
            import pdfplumber
            with pdfplumber.open(BytesIO(content)) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages]
            return "\n\n".join(pages).strip()
        except ImportError:
            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(BytesIO(content))
                return "\n\n".join(
                    page.extract_text() or "" for page in reader.pages
                ).strip()
            except ImportError:
                raise RuntimeError("需要安装 pdfplumber 或 PyPDF2 来解析 PDF")

    elif lower.endswith((".docx", ".doc")):
        try:
            from docx import Document as DocxDoc
            doc = DocxDoc(BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs).strip()
        except ImportError:
            raise RuntimeError("需要安装 python-docx 来解析 Word 文档")

    elif lower.endswith(".txt"):
        return content.decode("utf-8", errors="replace").strip()

    else:
        return content.decode("utf-8", errors="replace").strip()


def chunk_text(text: str) -> list[str]:
    """将长文本切分为重叠 chunk。"""
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start = end - CHUNK_OVERLAP
    return [c.strip() for c in chunks if c.strip()]


async def compute_embedding(text: str) -> list[float] | None:
    """通过外部 Embedding API 计算文本向量。"""
    try:
        import httpx
        from app.core.config import get_settings

        settings = get_settings()
        if not settings.embedding_api_key:
            logger.warning("Embedding API key not configured, skipping")
            return None

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{settings.embedding_base_url}/embeddings",
                headers={"Authorization": f"Bearer {settings.embedding_api_key}"},
                json={
                    "model": settings.embedding_model,
                    "input": text[:8000],
                    "dimensions": settings.embedding_dimensions,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["data"][0]["embedding"]
    except Exception as e:
        logger.warning("Embedding computation failed: %s", e)
        return None


async def ingest_document(
    db: AsyncSession,
    content: bytes,
    filename: str,
) -> dict:
    """提取文本 → 切片 → embedding → 入库（pgvector）。"""
    full_text = extract_text(content, filename)
    if not full_text:
        return {"chunks": 0, "filename": filename}

    # 保存原始文档
    doc_id = str(uuid.uuid4())
    doc = Document(id=doc_id, content=full_text, source_file=filename)
    db.add(doc)

    # 切片 + embedding
    chunks = chunk_text(full_text)
    created = 0

    for i, chunk in enumerate(chunks):
        embedding = await compute_embedding(chunk)
        chunk_obj = DocumentChunk(
            document_id=doc_id,
            content=chunk,
            source_file=filename,
            chunk_index=i,
            embedding=embedding,
        )
        db.add(chunk_obj)
        created += 1

    await db.commit()
    logger.info("Ingested %s: %d chunks with pgvector", filename, created)
    return {"chunks": created, "filename": filename}


async def search_knowledge(
    db: AsyncSession,
    query: str,
    top_k: int = 3,
) -> list[dict]:
    """使用 pgvector `<=>` 余弦距离检索 top-k 最相关切片。"""
    query_embedding = await compute_embedding(query)

    if not query_embedding:
        # 无 embedding 可用时回退到关键词匹配
        result = await db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.content.contains(query[:50]))
            .limit(top_k)
        )
        fallback = result.scalars().all()
        return [
            {"content": d.content, "source": d.source_file, "score": 0.5}
            for d in fallback
        ]

    # pgvector SQL: 按余弦距离排序（<=> 返回距离，1-距离=相似度）
    result = await db.execute(
        select(
            DocumentChunk.content,
            DocumentChunk.source_file,
            DocumentChunk.embedding.cosine_distance(query_embedding).label("distance"),
        )
        .where(DocumentChunk.embedding.is_not(None))
        .order_by("distance")
        .limit(top_k)
    )
    rows = result.all()

    return [
        {
            "content": row.content,
            "source": row.source_file,
            "score": round(1 - row.distance, 4),
        }
        for row in rows
        if row.distance < 0.7  # 相似度 > 0.3
    ]


async def build_rag_context(query: str) -> str | None:
    """为 AI 回复构建 RAG 上下文。返回拼接后的参考文本。"""
    try:
        from app.db.session import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            results = await search_knowledge(db, query, top_k=3)

        if not results:
            return None

        context_parts = []
        for i, r in enumerate(results, 1):
            context_parts.append(
                f"[参考资料 {i} - {r['source']}]\n{r['content']}"
            )

        return "\n\n".join(context_parts)
    except Exception as e:
        logger.warning("RAG context build failed: %s", e)
        return None
