"""异步自动评分 Worker — Phase 3.3。

独立 Worker 进程：接收作业提交 → 调用 LLM 生成结构化多维度评分 JSON → 存入 DB。
教师可直接复用或一票否决修改。

运行方式：python -m app.infra.grading_worker
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

GRADING_QUEUE = "q:grading_tasks"


async def push_grading_task(
    submission_id: str,
    student_id: str,
    content: str,
    assignment_title: str = "",
) -> bool:
    """将评分任务推入 Redis 队列。"""
    try:
        from app.infra.redis_client import get_client
        redis = get_client()
        if not redis:
            logger.warning("Redis not available, grading skipped")
            return False

        task = {
            "task_id": str(uuid.uuid4()),
            "submission_id": submission_id,
            "student_id": student_id,
            "content": content,
            "assignment_title": assignment_title,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        await redis.lpush(GRADING_QUEUE, json.dumps(task))
        logger.info("Grading task pushed: submission=%s", submission_id)
        return True
    except Exception as e:
        logger.error("Failed to push grading task: %s", e)
        return False


async def _grade_submission(task: dict) -> dict | None:
    """调用 LLM 对作业进行结构化评分。

    Returns:
        评分结果 dict 或 None（失败时）
    """
    try:
        from app.llm.factory import get_llm_client
        from app.llm.prompts import GRADER_PROMPT

        client = get_llm_client("deepseek")

        assignment_ctx = ""
        if task.get("assignment_title"):
            assignment_ctx = f"\n作业主题：{task['assignment_title']}\n"

        messages = [
            {"role": "system", "content": GRADER_PROMPT},
            {"role": "user", "content": f"{assignment_ctx}\n学生作业内容：\n{task['content']}"},
        ]

        full_response = ""
        async for chunk in client.stream_chat(messages=messages):
            full_response += chunk

        # 解析 JSON
        try:
            if "```" in full_response:
                json_str = full_response.split("```")[1]
                if json_str.startswith("json"):
                    json_str = json_str[4:]
                return json.loads(json_str.strip())
            else:
                return json.loads(full_response.strip())
        except json.JSONDecodeError:
            logger.error("Failed to parse grading JSON: %s", full_response[:200])
            return {"raw_response": full_response, "parse_error": True}

    except Exception as e:
        logger.error("Grading LLM call failed: %s", e)
        return None


async def _save_grading_result(
    submission_id: str,
    result: dict,
) -> None:
    """将评分结果保存到数据库。"""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.assignment import Assignment
        from sqlalchemy import select, update as sql_update

        async with AsyncSessionLocal() as db:
            await db.execute(
                sql_update(Assignment)
                .where(Assignment.assignment_id == submission_id)
                .values(
                    ai_review=result,
                )
            )
            await db.commit()

        logger.info("Grading result saved for submission=%s", submission_id)
    except Exception as e:
        logger.error("Failed to save grading result: %s", e)


async def grading_worker_loop() -> None:
    """评分 Worker 主循环 — BRPOP 消费评分任务。"""
    from app.infra.redis_client import get_client

    logger.info("Grading worker started, listening on %s", GRADING_QUEUE)

    while True:
        try:
            redis = get_client()
            if not redis:
                await asyncio.sleep(5)
                continue

            # 阻塞等待任务（超时 30 秒）
            result = await redis.brpop(GRADING_QUEUE, timeout=30)
            if not result:
                continue

            _, task_raw = result
            task = json.loads(task_raw)
            logger.info(
                "Processing grading task: submission=%s",
                task.get("submission_id"),
            )

            # 调用 LLM 评分
            grading_result = await _grade_submission(task)
            if grading_result:
                await _save_grading_result(
                    task["submission_id"],
                    grading_result,
                )

        except Exception as e:
            logger.error("Grading worker error: %s", e)
            await asyncio.sleep(5)


if __name__ == "__main__":
    import sys
    import os

    # 确保可以导入 app 包
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    async def main():
        from app.core.config import get_settings
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

        settings = get_settings()

        # Trap 3: Worker 独立 DB 连接池
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
        import app.db.session as db_session_mod
        db_session_mod.AsyncSessionLocal = worker_session_factory

        from app.infra import redis_client
        await redis_client.init()
        await grading_worker_loop()

    asyncio.run(main())
