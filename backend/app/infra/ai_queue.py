"""AI 请求队列 — Redis LPUSH 任务队列 + 本地 Semaphore 降级。

铁律 1 核心组件：
- 有 Redis：LPUSH 任务到 Redis 队列，由独立 Worker 进程消费
- 无 Redis：降级为本地 asyncio Semaphore 并发控制（兼容开发/测试）
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Redis 队列名
QUEUE_HIGH = "q:ai_tasks:high"
QUEUE_LOW = "q:ai_tasks:low"

# Pub/Sub channel 前缀（Worker 完成后发布结果）
STREAM_CHANNEL_PREFIX = "stream:"
RESULT_CHANNEL_PREFIX = "result:"


@dataclass
class QueueStats:
    """队列统计信息。"""
    waiting: int = 0
    running: int = 0
    total_processed: int = 0
    total_errors: int = 0


class AIRequestQueue:
    """AI 请求队列（Redis 模式 + 本地降级）。"""

    DEGRADE_THRESHOLD = 15

    def __init__(self) -> None:
        settings = get_settings()
        self._max_concurrency = settings.llm_max_concurrency
        self._semaphore = asyncio.Semaphore(self._max_concurrency)
        self._stats = QueueStats()
        self._timeout = settings.ai_queue_max_wait_s
        logger.info(
            "AI queue initialized: max_concurrency=%d, timeout=%.0fs",
            self._max_concurrency,
            self._timeout,
        )

    @property
    def stats(self) -> QueueStats:
        return self._stats

    @property
    def waiting_count(self) -> int:
        return self._stats.waiting

    @property
    def is_degraded(self) -> bool:
        return self._stats.waiting > self.DEGRADE_THRESHOLD

    async def push_task(
        self,
        *,
        session_id: str,
        user_msg_id: str,
        user_message: str,
        user_info: dict,
        llm_provider: str,
        messages: list[dict[str, str]],
        is_private: bool = False,
        conversation_id: str | None = None,
        priority: str = "high",
    ) -> str:
        """将 AI 任务推入 Redis 队列。

        Returns:
            task_id: 任务唯一 ID（用于前端追踪）
        """
        from app.infra import redis_client

        task_id = str(uuid.uuid4())
        task = {
            "task_id": task_id,
            "session_id": session_id,
            "user_msg_id": user_msg_id,
            "user_message": user_message,
            "user_info": user_info,
            "llm_provider": llm_provider,
            "messages": messages,
            "is_private": is_private,
            "conversation_id": conversation_id,
        }

        if redis_client.is_available():
            redis = redis_client.get_redis()
            queue_name = QUEUE_HIGH if priority == "high" else QUEUE_LOW
            await redis.lpush(queue_name, json.dumps(task))
            logger.info(
                "Task %s pushed to Redis queue %s", task_id, queue_name
            )
        else:
            # 降级：本地执行
            logger.info("Redis unavailable, executing task %s locally", task_id)
            await self._execute_locally(task)

        return task_id

    async def _execute_locally(self, task: dict) -> None:
        """降级模式：直接在本地执行 LLM 调用。"""
        from app.infra.ai_worker import execute_ai_task
        await execute_ai_task(task, local_mode=True)

    async def submit(self, coro_func, *args: Any, **kwargs: Any) -> Any:
        """本地 Semaphore 模式（降级 / 测试用）。"""
        self._stats.waiting += 1
        try:
            await asyncio.wait_for(
                self._semaphore.acquire(),
                timeout=self._timeout,
            )
        except asyncio.TimeoutError:
            self._stats.waiting -= 1
            raise asyncio.TimeoutError(
                f"AI 请求排队超时（等待超过 {self._timeout:.0f} 秒）"
            )

        self._stats.waiting -= 1
        self._stats.running += 1
        try:
            result = await coro_func(*args, **kwargs)
            self._stats.total_processed += 1
            return result
        except Exception:
            self._stats.total_errors += 1
            raise
        finally:
            self._stats.running -= 1
            self._semaphore.release()


# 全局单例
_queue: AIRequestQueue | None = None


def get_queue() -> AIRequestQueue:
    """获取全局 AI 请求队列实例。"""
    global _queue
    if _queue is None:
        _queue = AIRequestQueue()
    return _queue


def reset_queue() -> None:
    """重置队列（测试用）。"""
    global _queue
    _queue = None
