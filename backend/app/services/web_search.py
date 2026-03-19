"""Web Search 服务 — Tavily API 集成。

可插拔设计：后续更换为 Bing/Google/博查 只需修改此文件。
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

TAVILY_API_URL = "https://api.tavily.com/search"


async def web_search(
    query: str,
    *,
    max_results: int = 3,
    search_depth: str = "basic",
) -> list[dict[str, Any]]:
    """调用 Tavily Search API 获取搜索结果。

    Args:
        query: 搜索关键词
        max_results: 最大结果数
        search_depth: "basic" 或 "advanced"

    Returns:
        [{title, url, content}]
    """
    settings = get_settings()
    api_key = settings.search_api_key

    if not api_key:
        logger.warning("Search API key not configured, skipping web search")
        return []

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                TAVILY_API_URL,
                json={
                    "api_key": api_key,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": search_depth,
                    "include_answer": False,
                    "include_raw_content": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        for item in data.get("results", [])[:max_results]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "content": item.get("content", "")[:300],
            })

        logger.info("Web search for '%s': %d results", query[:50], len(results))
        return results

    except Exception as e:
        logger.warning("Web search failed: %s", e)
        return []
