"""默认支架种子数据。

应用启动时自动检查 scaffolds 表是否为空，若为空则插入默认支架。
"""
from __future__ import annotations

import logging

from app.db.session import AsyncSessionLocal
from app.models.scaffold import Scaffold

logger = logging.getLogger(__name__)

# 默认支架列表（4 种提示语支架）
_DEFAULT_SCAFFOLDS = [
    {
        "display_name": "启动型提示语支架",
        "prompt_template": (
            "我目前理解的核心问题是：______，"
            "我最不确定/最困惑的点是：______，"
            "作为该领域的研究型合作者，请你先不要直接给出结论，而是：\n"
            "① 帮我判断我对问题的理解是否存在遗漏或偏差；\n"
            "② 提出 2-3 个有助于我进一步思考的关键问题，和我一起澄清问题边界。"
        ),
        "sort_order": 1,
    },
    {
        "display_name": "深化型提示语支架 - 修正向",
        "prompt_template": (
            "看了你的回答，我认为 \"______\" 这部分解读的很全面，理由是______；"
            "我还认为 \"______\" 这部分需要修改/补充，理由是______，"
            "基于我的以上思考和看法，我尝试将该部分修改为：\"______\"。"
            "请你基于我的修改思路，指出其中可能存在的不足，并提出进一步优化建议。"
        ),
        "sort_order": 2,
    },
    {
        "display_name": "深化型提示语支架 - 批判向",
        "prompt_template": (
            "请你提出一种不同于前述方案的解决思路，并简要说明其核心假设。\n"
            "我认为这种方案与第一种方案相比优势在于______，"
            "劣势在于______，"
            "综合可行性、逻辑合理性与适用情境，我目前更倾向于______方案。"
            "请你基于我的判断，补充可能被我忽略的风险或支持性论据，"
            "帮助我进一步验证这一选择是否合理。"
        ),
        "sort_order": 3,
    },
    {
        "display_name": "反思型提示语支架",
        "prompt_template": (
            "回顾整个与你的对话过程，我做了以下反思：\n"
            "① 我在 \"______\" 这个对话节点对问题的理解发生了明显变化；\n"
            "② 我认为这一变化是由 AI 的哪类回应或我使用的哪种提示语引发的；\n"
            "③ 这一变化对我最终方案或理解产生了______的影响。\n"
            "请你补充一个可能被我忽略的变化节点或解释视角。"
        ),
        "sort_order": 4,
    },
]


async def seed_default_scaffolds() -> None:
    """如果 scaffolds 表为空，插入默认支架。"""
    from sqlalchemy import select, func

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(func.count()).select_from(Scaffold)
        )
        count = result.scalar() or 0
        if count > 0:
            logger.info("Scaffolds table already has %d rows, skip seeding.", count)
            return

        for data in _DEFAULT_SCAFFOLDS:
            db.add(Scaffold(**data))
        await db.commit()
        logger.info("Seeded %d default scaffolds.", len(_DEFAULT_SCAFFOLDS))
