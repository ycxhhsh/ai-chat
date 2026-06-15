from redis.exceptions import TimeoutError as RedisTimeoutError

from app.infra.redis_blocking import (
    blocking_read_redis_kwargs,
    is_blocking_read_timeout,
)


def test_blocking_read_connections_disable_socket_timeout():
    assert blocking_read_redis_kwargs()["socket_timeout"] is None


def test_timeout_reading_is_treated_as_idle_blocking_read():
    exc = RedisTimeoutError("Timeout reading from redis:6379")

    assert is_blocking_read_timeout(exc)


def test_other_redis_timeouts_are_not_treated_as_idle():
    exc = RedisTimeoutError("Timeout connecting to redis:6379")

    assert not is_blocking_read_timeout(exc)
