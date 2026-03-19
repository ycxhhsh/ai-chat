"""AI Worker — 独立进程消费 Redis 任务队列并流式调用 LLM。

铁律 1 核心组件：
- 作为独立进程运行：python -m app.infra.ai_worker
- 从 Redis 队列 BRPOP 任务
- 调用 LLM 流式 API
- 通过 Redis PUBLISH 将 chunk 发送回 FastAPI 进程

支持两种使用模式：
- 独立进程模式：命令行启动，持续监听 Redis 队列
- 本地模式：被 ai_queue.py 降级调用（无 Redis 时）
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import Any

logger = logging.getLogger(__name__)


async def execute_ai_task(
    task: dict[str, Any],
    *,
    local_mode: bool = False,
) -> None:
    """执行单个 AI 任务。

    Args:
        task: 任务数据（含 messages、llm_provider 等）
        local_mode: True 时直接通过 WS manager 发送 chunk（降级模式）
    """
    from app.core.config import get_settings
    from app.llm.factory import get_llm_client

    task_id = task["task_id"]
    session_id = task["session_id"]
    llm_provider = task["llm_provider"]
    messages = task["messages"]
    is_private = task.get("is_private", False)
    user_info = task.get("user_info", {})
    conversation_id = task.get("conversation_id")

    settings = get_settings()
    channel = f"cothink:ws:{session_id}"

    async def publish_event(event: str, data: dict) -> None:
        """发布事件到 Redis 或直接通过 WS manager 发送。"""
        payload = json.dumps({"event": event, "data": data})
        if local_mode:
            from app.websockets.manager import manager
            # AI_REPLY_DONE 不应推给前端（前端不处理），
            # 需走 Manager 落库 + 构造 CHAT_MESSAGE 逻辑
            if event == "AI_REPLY_DONE":
                await manager._handle_ai_reply_done(data)
                return
            if is_private:
                await manager.send_to_user(
                    session_id, user_info.get("user_id", ""),
                    event, data,
                )
            else:
                await manager.broadcast(session_id, event, data)
        else:
            import redis.asyncio as aioredis
            r = aioredis.from_url(
                settings.redis_url,
                decode_responses=True,
            )
            try:
                await r.publish(channel, payload)
            finally:
                await r.close()

    try:
        client = get_llm_client(llm_provider)
        full_content = ""
        search_sources: list[dict] = []

        # 通知 AI 开始
        await publish_event("AI_TYPING", {
            "is_typing": True,
            "provider": llm_provider,
            "task_id": task_id,
        })

        # ── 注入对话轮数上下文（渐进收敛策略） ──
        user_msg_count = sum(
            1 for m in messages
            if m.get("role") == "user"
            and not m.get("content", "").startswith("[系统备忘]")
        )
        if user_msg_count > 0:
            round_hint = {
                "role": "system",
                "content": (
                    f"[内部上下文] 当前对话已进行 {user_msg_count} 轮"
                    "用户提问。请根据渐进收敛策略调整回复风格。"
                ),
            }
            messages = list(messages)
            messages.insert(1, round_hint)

        # ── P3: 联网搜索环节 ──
        enable_search = task.get("enable_search", False)
        user_message = task.get("user_message", "")
        if enable_search and user_message:
            try:
                from app.services.search_intent import check_search_intent
                from app.services.web_search import web_search

                intent = await check_search_intent(user_message, llm_provider)
                if intent.get("needs_search"):
                    search_query = intent.get("query", user_message[:100])
                    search_sources = await web_search(search_query, max_results=3)
                    if search_sources:
                        # 将搜索结果注入 messages（插入到 user message 之前）
                        search_text = "\n\n".join(
                            f"[{i+1}] {r['title']}\n{r['content']}\n来源: {r['url']}"
                            for i, r in enumerate(search_sources)
                        )
                        search_msg = {
                            "role": "system",
                            "content": (
                                "### 联网搜索结果（请优先参考以下实时信息回答）：\n"
                                f"{search_text}"
                            ),
                        }
                        # 插入到倒数第二个位置（user message 之前）
                        messages = list(messages)
                        messages.insert(-1, search_msg)

                        # 推送搜索来源到前端
                        await publish_event("WEB_SEARCH_RESULT", {
                            "task_id": task_id,
                            "sources": search_sources,
                        })
                        logger.info(
                            "Web search injected %d results for task %s",
                            len(search_sources), task_id,
                        )
            except Exception as e:
                logger.warning("Web search step failed: %s", e)

        # 流式调用 LLM
        try:
            async with asyncio.timeout(settings.llm_stream_timeout_s):
                async for chunk in client.stream_chat(messages=messages):
                    full_content += chunk
                    await publish_event("AI_STREAM_CHUNK", {
                        "chunk": chunk,
                        "provider": llm_provider,
                        "task_id": task_id,
                    })
        except TimeoutError:
            logger.error(
                "LLM stream timeout (task=%s, provider=%s, chars=%d)",
                task_id, llm_provider, len(full_content),
            )
            if full_content:
                full_content += "\n\n[回复因超时被截断]"
            else:
                await publish_event("ERROR", {
                    "message": "AI 回复超时，请稍后再试。",
                    "code": "AI_TIMEOUT",
                    "task_id": task_id,
                })
                await publish_event("AI_TYPING", {"is_typing": False})
                return

        # 发布完成事件（含完整内容，用于落库）
        await publish_event("AI_REPLY_DONE", {
            "task_id": task_id,
            "session_id": session_id,
            "content": full_content,
            "llm_provider": llm_provider,
            "user_info": user_info,
            "is_private": is_private,
            "conversation_id": conversation_id,
        })

        # 结束打字状态
        await publish_event("AI_TYPING", {"is_typing": False})

        logger.info(
            "Task %s completed: provider=%s, chars=%d",
            task_id, llm_provider, len(full_content),
        )

        # ── P2: 异步触发支架智能推送 ──
        user_message = task.get("user_message", "")
        if is_private and user_message and full_content:
            try:
                # 检查教师端开关
                scaffold_enabled = True
                try:
                    from app.infra.redis_client import is_available, get_redis
                    if is_available():
                        pool = get_redis()
                        if pool:
                            val = await pool.get(
                                "cothink:config:scaffold_suggest_enabled"
                            )
                            if val is not None:
                                scaffold_enabled = str(val).lower() != "false"
                except Exception:
                    pass  # Redis 不可用时默认启用

                if scaffold_enabled:
                    # 从数据库加载活跃支架
                    from app.db.session import AsyncSessionLocal
                    from app.models.scaffold import Scaffold
                    from sqlalchemy import select

                    scaffolds_for_suggest = []
                    async with AsyncSessionLocal() as db:
                        result = await db.execute(
                            select(Scaffold)
                            .where(Scaffold.is_active == True)  # noqa: E712
                            .order_by(Scaffold.sort_order)
                        )
                        scaffolds_for_suggest = [
                            {
                                "scaffold_id": str(s.scaffold_id),
                                "display_name": s.display_name,
                                "prompt_template": s.prompt_template,
                            }
                            for s in result.scalars().all()
                        ]

                    if scaffolds_for_suggest:
                        from app.services.scaffold_suggest import (
                            generate_scaffold_suggestion,
                        )
                        suggestion = await generate_scaffold_suggestion(
                            user_message, full_content,
                            scaffolds_for_suggest, llm_provider,
                        )
                        if suggestion:
                            await publish_event("SCAFFOLD_SUGGEST", {
                                "task_id": task_id,
                                "session_id": session_id,
                                **suggestion,
                            })
            except Exception as e:
                logger.warning("Scaffold suggestion failed: %s", e)

    except Exception as e:
        logger.exception("Task %s failed: %s", task_id, e)
        await publish_event("ERROR", {
            "message": f"AI 回复失败: {e}",
            "code": "AI_ERROR",
            "task_id": task_id,
        })
        await publish_event("AI_TYPING", {"is_typing": False})


async def worker_loop() -> None:
    """Worker 主循环：从 Redis 队列消费任务。"""
    import redis.asyncio as aioredis
    from app.core.config import get_settings
    from app.infra.ai_queue import QUEUE_HIGH, QUEUE_LOW

    settings = get_settings()

    # Trap 3: Worker 必须初始化独立的 DB 连接池
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    worker_engine = create_async_engine(
        settings.db_url,
        echo=False,
        pool_size=3,
        max_overflow=2,
    )
    worker_session_factory = async_sessionmaker(
        worker_engine,
        expire_on_commit=False,
    )
    # 将 Worker 专属 session factory 挂到全局以供 context_builder 等使用
    import app.db.session as db_session_mod
    db_session_mod.AsyncSessionLocal = worker_session_factory

    redis = aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
    )

    logger.info("AI Worker started, listening on queues: %s, %s",
                QUEUE_HIGH, QUEUE_LOW)

    try:
        while True:
            try:
                # 优先消费高优队列，然后低优队列
                result = await redis.brpop(
                    [QUEUE_HIGH, QUEUE_LOW],
                    timeout=5,
                )

                if result is None:
                    # 超时，无任务，继续等待
                    continue

                queue_name, task_raw = result
                task = json.loads(task_raw)
                task_id = task.get("task_id", "unknown")

                logger.info(
                    "Picked task %s from %s", task_id, queue_name
                )

                # 执行任务（不阻塞主循环，允许并发）
                await execute_ai_task(task, local_mode=False)

            except json.JSONDecodeError as e:
                logger.error("Invalid task JSON: %s", e)
            except Exception as e:
                logger.error("Worker error: %s", e)
                await asyncio.sleep(1)
    finally:
        await redis.close()


def get_queue_status() -> dict:
    """获取当前队列状态（用于前端展示）。"""
    from app.infra.ai_queue import get_queue
    queue = get_queue()
    stats = queue.stats
    return {
        "waiting": stats.waiting,
        "running": stats.running,
        "total_processed": stats.total_processed,
        "total_errors": stats.total_errors,
        "is_degraded": queue.is_degraded,
    }


if __name__ == "__main__":
    # 独立进程入口
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logger.info("Starting AI Worker process...")
    asyncio.run(worker_loop())
