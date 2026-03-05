"""CoThink AI 应用入口。"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.db.session import engine
from app.routers.auth import router as auth_router
from app.routers.groups import router as groups_router
from app.routers.scaffold import router as scaffold_router
from app.routers.roster import router as roster_router
from app.routers.llm import router as llm_router
from app.routers.teacher import router as teacher_router
from app.routers.knowledge import router as knowledge_router
from app.routers.assignments import router as assignments_router
from app.routers.observability import router as observability_router
from app.routers.courses import router as courses_router
from app.routers.ai_conversations import router as ai_conversations_router
from app.routers.upload import router as upload_router
from app.websockets.router import router as websocket_router

logger = logging.getLogger(__name__)

# ── 结构化日志（P2-12）──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 数据库建表由 Alembic 管理（alembic upgrade head）

    # 种子数据
    from app.db.seed_scaffolds import seed_default_scaffolds
    await seed_default_scaffolds()

    from app.db.seed_roster import seed_roster
    await seed_roster()

    # 初始化 Redis（可选，不可用时降级为本地模式）
    from app.infra import redis_client
    await redis_client.init()

    # 预热 AI 请求队列
    from app.infra.ai_queue import get_queue
    get_queue()

    try:
        yield
    finally:
        await redis_client.close()
        await engine.dispose()


app = FastAPI(title="CoThink AI", version="3.0.0", lifespan=lifespan)

# CORS 配置：支持 * (开发) 或逗号分隔白名单 (生产)
from app.core.config import get_settings as _get_settings
_cors_origins_raw = _get_settings().cors_origins
_cors_origins = (
    ["*"] if _cors_origins_raw.strip() == "*"
    else [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# P2-12: 请求日志中间件
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000, 1)
    logger.info(
        "%s %s → %d (%.1fms)",
        request.method, request.url.path, response.status_code, duration_ms,
    )
    return response


# ── HTTP Routers ──
app.include_router(auth_router)
app.include_router(groups_router)
app.include_router(scaffold_router)
app.include_router(roster_router)
app.include_router(llm_router)
app.include_router(teacher_router)
app.include_router(knowledge_router)
app.include_router(assignments_router)
app.include_router(observability_router)
app.include_router(courses_router)
app.include_router(ai_conversations_router)
app.include_router(upload_router)

# ── WebSocket ──
app.include_router(websocket_router)

# ── 静态文件：上传附件 ──
_upload_dir = os.environ.get("UPLOAD_DIR", "/opt/cothink/uploads")
os.makedirs(_upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_upload_dir), name="uploads")

