"""可观测性路由 — 健康检查、指标。"""
from __future__ import annotations

import time

from fastapi import APIRouter
from starlette.requests import Request
from starlette.responses import PlainTextResponse

router = APIRouter(tags=["observability"])

_START_TIME = time.time()


@router.get("/healthz")
async def healthz():
    """K8s / Docker 存活探针。"""
    uptime = int(time.time() - _START_TIME)
    return {
        "status": "ok",
        "uptime_seconds": uptime,
    }


@router.get("/readyz")
async def readyz():
    """就绪探针 — 检查 DB 连接。"""
    try:
        from app.db.session import AsyncSessionLocal
        from sqlalchemy import text
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ready"}
    except Exception as e:
        return PlainTextResponse(
            f"NOT READY: {e}", status_code=503
        )


@router.get("/metrics")
async def metrics():
    """简易 Prometheus 风格指标。"""
    from app.infra.ai_worker import get_queue_status
    try:
        queue = get_queue_status()
    except Exception:
        queue = {}

    uptime = int(time.time() - _START_TIME)

    lines = [
        "# HELP cothink_uptime_seconds Server uptime in seconds",
        "# TYPE cothink_uptime_seconds gauge",
        f"cothink_uptime_seconds {uptime}",
        "",
        "# HELP cothink_ai_queue_waiting Number of AI requests waiting",
        "# TYPE cothink_ai_queue_waiting gauge",
        f'cothink_ai_queue_waiting {queue.get("waiting", 0)}',
        "",
        "# HELP cothink_ai_queue_running Number of AI requests running",
        "# TYPE cothink_ai_queue_running gauge",
        f'cothink_ai_queue_running {queue.get("running", 0)}',
        "",
        "# HELP cothink_ai_total_processed Total AI requests processed",
        "# TYPE cothink_ai_total_processed counter",
        f'cothink_ai_total_processed {queue.get("total_processed", 0)}',
        "",
        "# HELP cothink_ai_total_errors Total AI request errors",
        "# TYPE cothink_ai_total_errors counter",
        f'cothink_ai_total_errors {queue.get("total_errors", 0)}',
    ]

    return PlainTextResponse("\n".join(lines), media_type="text/plain")
