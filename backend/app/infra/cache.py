"""Redis 缓存装饰器 — 高频低变查询加速。

Redis 不可用时自动穿透（不缓存）。

用法：
    @redis_cache("teacher:stats", ttl=60)
    async def get_stats(db):
        ...
"""
from __future__ import annotations

import hashlib
import json
import logging
from functools import wraps
from typing import Any, Callable

logger = logging.getLogger(__name__)


def redis_cache(key_prefix: str, ttl: int = 300):
    """异步 Redis 缓存装饰器。

    Args:
        key_prefix: 缓存 key 前缀
        ttl: 过期时间（秒）
    """

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            from app.infra.redis_client import get_redis

            redis = get_redis()
            if not redis:
                # Redis 不可用 → 直接穿透
                return await fn(*args, **kwargs)

            # 用参数生成唯一 key（排除 db session 等不可序列化对象）
            key_parts = []
            for a in args:
                if hasattr(a, "__class__") and "Session" in a.__class__.__name__:
                    continue  # 跳过 DB session
                key_parts.append(str(a))
            for k, v in sorted(kwargs.items()):
                if k == "db":
                    continue
                key_parts.append(f"{k}={v}")

            key_hash = hashlib.md5(
                "|".join(key_parts).encode()
            ).hexdigest()[:12]
            cache_key = f"cache:{key_prefix}:{key_hash}"

            try:
                cached = await redis.get(cache_key)
                if cached:
                    return json.loads(cached)
            except Exception as e:
                logger.debug("Cache read failed: %s", e)

            # 未命中 → 执行原函数
            result = await fn(*args, **kwargs)

            try:
                await redis.setex(cache_key, ttl, json.dumps(result, default=str))
            except Exception as e:
                logger.debug("Cache write failed: %s", e)

            return result

        # 暴露原函数方便测试
        wrapper.__wrapped__ = fn  # type: ignore
        return wrapper

    return decorator
