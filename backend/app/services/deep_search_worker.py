"""DeepSearch Worker — 多轮搜索 + LLM 综合分析。

流程：用户提交主题 → 拆解子问题 → 每个子问题搜索 → 收集结果 → LLM 综合报告 → 更新 Job
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.services.web_search import web_search

logger = logging.getLogger(__name__)

DECOMPOSE_PROMPT = """\
你是一个研究助理。请将用户的研究主题拆解为 3-5 个精确的子问题/搜索查询词。

用户主题: {topic}

输出严格 JSON（不要加 markdown 标记）：
["子问题1", "子问题2", "子问题3"]
"""

SYNTHESIZE_PROMPT = """\
你是一个综合分析专家。根据以下搜索结果，撰写一份全面的调研报告。

研究主题: {topic}

搜索结果:
{search_results}

要求：
1. 使用 Markdown 格式
2. 包含标题和小节
3. 引用来源（使用 [序号] 标注）
4. 总结关键发现
5. 中文撰写
"""


async def run_deep_search(
    topic: str,
    job_id: str,
    user_id: str,
    session_id: str | None,
    llm_provider: str = "deepseek",
) -> dict[str, Any]:
    """执行深度调研任务。

    Returns:
        {"report": str, "sources": list, "sub_queries": list}
    """
    from app.infra import redis_client
    from app.llm.factory import get_llm_client
    from app.db.session import AsyncSessionLocal

    channel = f"cothink:ws:{session_id}" if session_id else None

    async def update_progress(progress: int, status_text: str) -> None:
        """更新 Job 进度并推送 WS 事件。"""
        # 更新数据库
        async with AsyncSessionLocal() as db:
            from sqlalchemy import update
            from app.models.job import Job
            await db.execute(
                update(Job).where(Job.id == job_id).values(progress=progress)
            )
            await db.commit()

        # 推送 WS 进度事件
        if channel and redis_client.is_available():
            redis = redis_client.get_redis()
            await redis.publish(channel, json.dumps({
                "event": "JOB_PROGRESS",
                "data": {
                    "job_id": job_id,
                    "progress": progress,
                    "status_text": status_text,
                },
            }))

    try:
        client = get_llm_client(llm_provider)

        # ── Step 1: 拆解子问题 (10%) ──
        await update_progress(5, "正在分析研究主题...")

        messages = [
            {"role": "system", "content": DECOMPOSE_PROMPT.format(topic=topic)},
            {"role": "user", "content": topic},
        ]
        parts: list[str] = []
        async for chunk in client.stream_chat(messages=messages, temperature=0.3):
            parts.append(chunk)
        raw = "".join(parts).strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]

        try:
            sub_queries = json.loads(raw.strip())
        except json.JSONDecodeError:
            sub_queries = [topic]

        await update_progress(10, f"已拆解为 {len(sub_queries)} 个子问题")

        # ── Step 2: 搜索每个子问题 (10-70%) ──
        all_sources: list[dict] = []
        search_text_parts: list[str] = []

        for i, query in enumerate(sub_queries):
            pct = 10 + int((i / len(sub_queries)) * 60)
            await update_progress(pct, f"搜索: {query[:30]}...")

            # 搜索失败重试 1 次
            try:
                results = await web_search(query, max_results=3)
            except Exception as e:
                logger.warning("Search failed for '%s', retrying: %s", query, e)
                await asyncio.sleep(1)
                try:
                    results = await web_search(query, max_results=3)
                except Exception:
                    logger.warning("Search retry failed for '%s', skipping", query)
                    results = []

            for r in results:
                r["query"] = query
            all_sources.extend(results)

            for j, r in enumerate(results):
                idx = len(search_text_parts) + 1
                search_text_parts.append(
                    f"[{idx}] 查询「{query}」\n标题: {r['title']}\n内容: {r['content']}\n来源: {r['url']}"
                )

            await asyncio.sleep(0.5)  # 控制 API 速率

        await update_progress(70, "搜索完成，正在撰写报告...")

        # ── Step 3: LLM 综合报告 (70-95%) ──
        search_results_text = "\n\n".join(search_text_parts)
        messages = [
            {"role": "system", "content": SYNTHESIZE_PROMPT.format(
                topic=topic, search_results=search_results_text
            )},
            {"role": "user", "content": f"请基于以上搜索结果，撰写关于「{topic}」的综合调研报告。"},
        ]

        report_parts: list[str] = []
        try:
            async for chunk in client.stream_chat(messages=messages, temperature=0.5):
                report_parts.append(chunk)
            report = "".join(report_parts).strip()
        except Exception as e:
            logger.warning("Report synthesis failed, retrying: %s", e)
            report_parts = []
            async for chunk in client.stream_chat(messages=messages, temperature=0.5):
                report_parts.append(chunk)
            report = "".join(report_parts).strip()
        await update_progress(95, "报告撰写完成")

        # ── Step 4: 完成 ──
        result = {
            "report": report,
            "sources": all_sources,
            "sub_queries": sub_queries,
        }

        # 更新 Job 为完成
        async with AsyncSessionLocal() as db:
            from sqlalchemy import update
            from app.models.job import Job
            from app.models.notification import Notification
            import uuid

            await db.execute(
                update(Job).where(Job.id == job_id).values(
                    status="done",
                    progress=100,
                    result=result,
                )
            )

            # 创建通知
            notif = Notification(
                id=uuid.uuid4(),
                user_id=user_id,
                type="job_done",
                title=f"调研完成：{topic[:50]}",
                content=f"深度调研「{topic[:50]}」已完成，共搜索 {len(all_sources)} 条来源。",
                job_id=job_id,
            )
            db.add(notif)
            await db.commit()

        await update_progress(100, "完成")

        # 推送完成通知
        if channel and redis_client.is_available():
            redis = redis_client.get_redis()
            await redis.publish(channel, json.dumps({
                "event": "JOB_DONE",
                "data": {
                    "job_id": job_id,
                    "title": f"调研完成：{topic[:50]}",
                    "type": "deep_search",
                },
            }))

        return result

    except Exception as e:
        logger.exception("DeepSearch failed for job %s: %s", job_id, e)
        # 标记失败
        async with AsyncSessionLocal() as db:
            from sqlalchemy import update
            from app.models.job import Job
            await db.execute(
                update(Job).where(Job.id == job_id).values(
                    status="failed",
                    error_message=str(e)[:500],
                )
            )
            await db.commit()
        raise
