"""Redis 异步客户端管理。

支持两种模式：
- 有 Redis：使用连接池 + pubsub（生产环境，多 worker）
- 无 Redis：优雅降级，所有操作返回空值（本地开发）
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import redis.asyncio as aioredis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_pool: Optional[aioredis.Redis] = None
_available: bool = False


async def init() -> None:
    """初始化 Redis 连接池。连接失败时降级为无 Redis 模式。"""
    global _pool, _available
    settings = get_settings()
    try:
        _pool = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            max_connections=20,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
        await asyncio.wait_for(_pool.ping(), timeout=3)
        _available = True
        logger.info("Redis connected: %s", settings.redis_url)
    except Exception as e:
        _available = False
        if _pool:
            try:
                await _pool.close()
            except Exception:
                pass
        _pool = None
        logger.warning("Redis unavailable, falling back to local mode: %s", e)


async def close() -> None:
    """关闭 Redis 连接池。"""
    global _pool, _available
    if _pool:
        await _pool.close()
        _pool = None
    _available = False
    logger.info("Redis connection closed")


def get_redis() -> Optional[aioredis.Redis]:
    """获取 Redis 客户端实例。不可用时返回 None。"""
    return _pool if _available else None


def is_available() -> bool:
    """Redis 是否可用。"""
    return _available


async def publish(channel: str, message: str) -> None:
    """向 Redis channel 发布消息。不可用时静默跳过。"""
    if _available and _pool:
        try:
            await _pool.publish(channel, message)
        except Exception as e:
            logger.warning("Redis publish failed: %s", e)


async def subscribe(channel: str) -> Optional[aioredis.client.PubSub]:
    """订阅 Redis channel（使用独立连接，无 socket_timeout）。

    pubsub 需要长时间阻塞等待消息，不能使用主连接池的 socket_timeout=3s，
    否则 3 秒无消息就会超时断开。
    """
    if not _available:
        return None
    try:
        # 为 pubsub 创建独立连接，不设 socket_timeout
        from app.core.config import get_settings
        settings = get_settings()
        dedicated = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=5,
            # 不设 socket_timeout → 阻塞读无限等待
        )
        pubsub = dedicated.pubsub()
        await pubsub.subscribe(channel)
        return pubsub
    except Exception as e:
        logger.warning("Redis subscribe failed: %s", e)
    return None

