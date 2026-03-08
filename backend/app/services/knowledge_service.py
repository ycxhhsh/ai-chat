"""RAG 知识库服务 — pgvector 向量检索 + 混合检索预埋。

文档流程：PDF/Word 上传 → 文本提取 → 语义切片 → Embedding → 入库
检索流程：query embedding → pgvector SQL `<=>` 余弦距离 → top-k 返回
           或 hybrid 模式 → vector + keyword → RRF 融合排序
"""
from __future__ import annotations

import logging
import re
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
    """语义感知切分：优先按段落分割，再按句号兜底，最后定长回退。

    策略优先级：
    1. 按段落（双换行 / Markdown 标题）分割
    2. 段落超长时按句号二次切分
    3. 句子仍超长时退化为定长窗口
    """
    # 按段落分割（双换行 或 Markdown 标题行）
    paragraphs = re.split(r'\n{2,}|(?=^#{1,3}\s)', text, flags=re.MULTILINE)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    chunks: list[str] = []
    buffer = ""

    for para in paragraphs:
        # 当前 buffer + 段落不超限 → 合并
        if len(buffer) + len(para) + 2 < CHUNK_SIZE:
            buffer = f"{buffer}\n\n{para}" if buffer else para
            continue

        # 先存 buffer
        if buffer:
            chunks.append(buffer.strip())
            buffer = ""

        # 段落本身超长 → 按句号二次切分
        if len(para) > CHUNK_SIZE:
            sentences = re.split(r'(?<=[。！？.!?\n])\s*', para)
            sub_buf = ""
            for s in sentences:
                if not s.strip():
                    continue
                if len(sub_buf) + len(s) + 1 < CHUNK_SIZE:
                    sub_buf = f"{sub_buf}{s}" if sub_buf else s
                else:
                    if sub_buf:
                        chunks.append(sub_buf.strip())
                    # 单个句子仍超长 → 定长窗口兜底
                    if len(s) > CHUNK_SIZE:
                        start = 0
                        while start < len(s):
                            end = start + CHUNK_SIZE
                            chunks.append(s[start:end].strip())
                            start = end - CHUNK_OVERLAP
                        sub_buf = ""
                    else:
                        sub_buf = s
            if sub_buf.strip():
                buffer = sub_buf
        else:
            buffer = para

    if buffer.strip():
        chunks.append(buffer.strip())

    return chunks


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
    """提取文本 → 语义切片 → embedding → 入库（pgvector）。"""
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
    logger.info("Ingested %s: %d chunks with semantic splitting", filename, created)
    return {"chunks": created, "filename": filename}


async def search_knowledge(
    db: AsyncSession,
    query: str,
    top_k: int = 3,
    *,
    strategy: str = "vector",
) -> list[dict]:
    """统一检索入口，支持 vector / keyword / hybrid 三种策略。

    Args:
        strategy: 检索策略
            - "vector"  (默认) pgvector 余弦距离
            - "keyword" 关键词 LIKE 回退
            - "hybrid"  vector + keyword → RRF 融合排序
    """
    if strategy == "keyword":
        return await _keyword_search(db, query, top_k)
    elif strategy == "hybrid":
        vec_results = await _vector_search(db, query, top_k * 2)
        kw_results = await _keyword_search(db, query, top_k * 2)
        return _reciprocal_rank_fusion(vec_results, kw_results, top_k)
    else:
        return await _vector_search(db, query, top_k)


async def _vector_search(
    db: AsyncSession, query: str, top_k: int
) -> list[dict]:
    """pgvector `<=>` 余弦距离检索。"""
    query_embedding = await compute_embedding(query)

    if not query_embedding:
        # 无 embedding → 降级为关键词
        return await _keyword_search(db, query, top_k)

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


async def _keyword_search(
    db: AsyncSession, query: str, top_k: int
) -> list[dict]:
    """关键词 LIKE 检索（fallback / BM25 预留位）。

    TODO: 后续替换为 pg_trgm 或 Elasticsearch BM25
    """
    # 取 query 前 50 字作为关键词
    keyword = query[:50]
    result = await db.execute(
        select(DocumentChunk)
        .where(DocumentChunk.content.contains(keyword))
        .limit(top_k)
    )
    fallback = result.scalars().all()
    return [
        {"content": d.content, "source": d.source_file, "score": 0.5}
        for d in fallback
    ]


def _reciprocal_rank_fusion(
    vec_results: list[dict],
    kw_results: list[dict],
    top_k: int,
    k: int = 60,
) -> list[dict]:
    """Reciprocal Rank Fusion (RRF) 融合排序。

    RRF score = Σ 1/(k + rank_i) ，k 通常取 60。
    后续集成 BM25 或 BGE Reranker 时可直接复用本函数。
    """
    # content → 融合分数
    scores: dict[str, float] = {}
    meta: dict[str, dict] = {}

    for rank, item in enumerate(vec_results):
        key = item["content"][:100]  # 用内容前 100 字去重
        scores[key] = scores.get(key, 0) + 1.0 / (k + rank)
        meta[key] = item

    for rank, item in enumerate(kw_results):
        key = item["content"][:100]
        scores[key] = scores.get(key, 0) + 1.0 / (k + rank)
        if key not in meta:
            meta[key] = item

    # 按 RRF 分数倒序排
    sorted_keys = sorted(scores, key=lambda x: scores[x], reverse=True)
    results = []
    for key in sorted_keys[:top_k]:
        item = meta[key].copy()
        item["score"] = round(scores[key], 4)
        results.append(item)

    return results


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
