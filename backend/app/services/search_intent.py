"""搜索意图判断服务 — 轻量 LLM 判断是否需要联网搜索。"""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

INTENT_PROMPT = """\
你是一个搜索意图判断器。分析用户的问题，判断是否需要联网搜索来回答。

需要搜索的场景：
- 涉及时效性信息（最新新闻、当前价格、实时数据）
- 询问具体事实（特定公司、产品、人物的最新状态）
- 需要最新技术文档、API 用法等
- 用户明确要求搜索或查找

不需要搜索的场景：
- 基础概念解释、教学问题
- 编程基础、算法逻辑
- 个人观点、建议类问题
- 已在上下文/教材中有答案的问题

输出严格 JSON（不要加 markdown 标记）：
{"needs_search": true, "query": "优化后的搜索关键词"}
或
{"needs_search": false}
"""


async def check_search_intent(
    user_message: str,
    llm_provider: str = "deepseek",
) -> dict:
    """判断用户消息是否需要联网搜索。

    Returns:
        {"needs_search": bool, "query": str | None}
    """
    try:
        from app.llm.factory import get_llm_client

        client = get_llm_client(llm_provider)
        messages = [
            {"role": "system", "content": INTENT_PROMPT},
            {"role": "user", "content": user_message[:500]},
        ]

        parts: list[str] = []
        async for chunk in client.stream_chat(
            messages=messages, temperature=0.1
        ):
            parts.append(chunk)

        raw = "".join(parts).strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()

        result = json.loads(raw)
        return {
            "needs_search": result.get("needs_search", False),
            "query": result.get("query", user_message[:100]),
        }

    except Exception as e:
        logger.warning("Search intent check failed: %s", e)
        return {"needs_search": False, "query": None}
