"""LLM 调用熔断器 — 防止级联故障。

当某 Provider 连续失败 N 次后自动跳闸，在恢复窗口期间拒绝请求，
到达恢复时间后进入半开状态放行一个探测请求。

用法：
    breaker = CircuitBreaker(name="deepseek")
    breaker.check()        # 跳闸时抛 CircuitOpenError
    try:
        result = await call_llm()
        breaker.record_success()
    except Exception:
        breaker.record_failure()
        raise
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


class CircuitOpenError(Exception):
    """断路器处于 OPEN 状态，拒绝请求。"""

    def __init__(self, name: str, retry_after: float):
        self.name = name
        self.retry_after = retry_after
        super().__init__(
            f"Circuit breaker '{name}' is OPEN. "
            f"Retry after {retry_after:.0f}s."
        )


class CircuitBreaker:
    """简易断路器：CLOSED → OPEN → HALF_OPEN → CLOSED。

    Args:
        name: 标识名称（通常为 provider name）
        failure_threshold: 连续失败多少次后跳闸
        recovery_timeout: 跳闸后多久进入半开（秒）
    """

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout: float = 60.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._state = self.CLOSED
        self._failure_count = 0
        self._last_failure_time = 0.0

    @property
    def state(self) -> str:
        if self._state == self.OPEN:
            # 检查是否到达恢复窗口 → 自动转半开
            if time.monotonic() - self._last_failure_time >= self.recovery_timeout:
                self._state = self.HALF_OPEN
                logger.info(
                    "Circuit breaker '%s' → HALF_OPEN (probing)",
                    self.name,
                )
        return self._state

    def check(self) -> None:
        """调用前检查。OPEN 状态抛 CircuitOpenError。"""
        current = self.state
        if current == self.OPEN:
            elapsed = time.monotonic() - self._last_failure_time
            raise CircuitOpenError(
                self.name,
                retry_after=max(0, self.recovery_timeout - elapsed),
            )
        # CLOSED / HALF_OPEN → 放行

    def record_success(self) -> None:
        """记录一次成功。HALF_OPEN → CLOSED。"""
        if self._state != self.CLOSED:
            logger.info(
                "Circuit breaker '%s' → CLOSED (recovered)", self.name,
            )
        self._state = self.CLOSED
        self._failure_count = 0

    def record_failure(self) -> None:
        """记录一次失败。达到阈值 → OPEN。"""
        self._failure_count += 1
        self._last_failure_time = time.monotonic()

        if self._state == self.HALF_OPEN:
            # 半开探测失败 → 重回 OPEN
            self._state = self.OPEN
            logger.warning(
                "Circuit breaker '%s' → OPEN (probe failed)", self.name,
            )
        elif self._failure_count >= self.failure_threshold:
            self._state = self.OPEN
            logger.warning(
                "Circuit breaker '%s' → OPEN "
                "(failures=%d >= threshold=%d, cooldown=%.0fs)",
                self.name,
                self._failure_count,
                self.failure_threshold,
                self.recovery_timeout,
            )
