"""Helpers for Redis blocking-read consumers."""
from __future__ import annotations


def blocking_read_redis_kwargs() -> dict[str, object]:
    return {
        "socket_connect_timeout": 5,
        "socket_timeout": None,
    }


def is_blocking_read_timeout(exc: BaseException) -> bool:
    try:
        from redis.exceptions import TimeoutError as RedisTimeoutError
    except Exception:
        return False

    return isinstance(exc, RedisTimeoutError) and "Timeout reading" in str(exc)
