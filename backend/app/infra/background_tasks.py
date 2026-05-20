"""Process-level background task tracking."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from typing import Any

logger = logging.getLogger(__name__)

_tasks: set[asyncio.Task[Any]] = set()


def track_task(coro: Awaitable[Any], *, name: str | None = None) -> asyncio.Task[Any]:
    """Create and track a background task for graceful shutdown."""
    task = asyncio.create_task(coro, name=name)
    _tasks.add(task)

    def _cleanup(done_task: asyncio.Task[Any]) -> None:
        _tasks.discard(done_task)
        if done_task.cancelled():
            return
        exc = done_task.exception()
        if exc:
            logger.warning("Background task failed: %s", exc, exc_info=exc)

    task.add_done_callback(_cleanup)
    return task


async def shutdown_background_tasks() -> None:
    """Cancel and await all tracked process-level background tasks."""
    pending = [task for task in list(_tasks) if not task.done()]
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    _tasks.clear()
