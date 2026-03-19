"""学习支架智能推送服务。

重新设计：
1. 需求判断 — 轻量 LLM 调用判断学生是否需要支架
2. 模板预填 — 将已有支架模板的占位符用对话上下文填充
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def _check_scaffold_need(
    user_message: str,
    ai_response: str,
    scaffold_names: list[str],
    llm_provider: str = "deepseek",
) -> dict[str, Any] | None:
    """Step 1: 判断学生是否需要支架辅助。"""
    from app.llm.factory import get_llm_client
    from app.llm.prompts import SCAFFOLD_NEED_CHECK_PROMPT

    scaffold_list = "\n".join(
        f"{i}. {name}" for i, name in enumerate(scaffold_names)
    )
    prompt = SCAFFOLD_NEED_CHECK_PROMPT.format(scaffold_list=scaffold_list)

    client = get_llm_client(llm_provider)
    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"【学生消息】\n{user_message[:400]}\n\n"
                f"【AI 回复】\n{ai_response[:400]}"
            ),
        },
    ]

    parts: list[str] = []
    async for chunk in client.stream_chat(messages=messages, temperature=0.2):
        parts.append(chunk)

    raw = "".join(parts).strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]

    result = json.loads(raw.strip())
    return result


async def _fill_scaffold_template(
    user_message: str,
    ai_response: str,
    template: str,
    llm_provider: str = "deepseek",
) -> str | None:
    """Step 2: 用对话上下文预填支架模板占位符。"""
    from app.llm.factory import get_llm_client
    from app.llm.prompts import SCAFFOLD_FILL_PROMPT

    prompt = SCAFFOLD_FILL_PROMPT.format(
        user_message=user_message[:400],
        ai_response=ai_response[:400],
        template=template,
    )

    client = get_llm_client(llm_provider)
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": "请根据对话内容填写上方模板。"},
    ]

    parts: list[str] = []
    async for chunk in client.stream_chat(messages=messages, temperature=0.3):
        parts.append(chunk)

    raw = "".join(parts).strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]

    result = json.loads(raw.strip())
    return result.get("filled_template")


async def generate_scaffold_suggestion(
    user_message: str,
    ai_response: str,
    scaffolds: list[dict[str, str]],
    llm_provider: str = "deepseek",
) -> dict[str, Any] | None:
    """两步生成支架建议。

    Args:
        user_message: 学生消息
        ai_response: AI 回复
        scaffolds: 已有支架列表 [{"scaffold_id", "display_name", "prompt_template"}]
        llm_provider: LLM 提供商

    Returns:
        {
            "needs_scaffold": True,
            "learning_state": "confused",
            "recommended_index": 0,
            "scaffolds": [
                {"scaffold_id": "...", "label": "...", "content": "预填后模板"},
                ...
            ]
        }
        或 None（学生不需要/失败）
    """
    if not scaffolds:
        return None

    try:
        # ── Step 1: 需求判断 ──
        names = [s["display_name"] for s in scaffolds]
        check = await _check_scaffold_need(
            user_message, ai_response, names, llm_provider,
        )
        if not check or not check.get("needs_scaffold"):
            logger.info("Scaffold not needed: %s", check)
            return None

        recommended_idx = check.get("recommended_index", 0)
        if recommended_idx >= len(scaffolds):
            recommended_idx = 0
        learning_state = check.get("learning_state", "exploring")

        # ── Step 2: 并发预填所有支架模板 ──
        import asyncio

        async def fill_one(s: dict) -> dict:
            try:
                filled = await _fill_scaffold_template(
                    user_message, ai_response,
                    s["prompt_template"], llm_provider,
                )
                return {
                    "scaffold_id": s["scaffold_id"],
                    "label": s["display_name"],
                    "content": filled or s["prompt_template"],
                }
            except Exception as e:
                logger.warning("Fill scaffold %s failed: %s", s["display_name"], e)
                return {
                    "scaffold_id": s["scaffold_id"],
                    "label": s["display_name"],
                    "content": s["prompt_template"],
                }

        filled_scaffolds = await asyncio.gather(*[fill_one(s) for s in scaffolds])

        return {
            "needs_scaffold": True,
            "learning_state": learning_state,
            "recommended_index": recommended_idx,
            "scaffolds": list(filled_scaffolds),
        }

    except json.JSONDecodeError as e:
        logger.warning("Scaffold check JSON parse failed: %s", e)
        return None
    except Exception as e:
        logger.warning("Scaffold suggestion failed: %s", e)
        return None
