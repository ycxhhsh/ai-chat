"""Lightweight observation rules for collaboration-role actions."""
from __future__ import annotations

from typing import Iterable


ROLE_ACTION_LABELS = {
    "推进者": "推动下一步",
    "提问者": "提出问题",
    "解释者": "解释说明",
    "质疑者": "提出质疑",
    "总结者": "总结归纳",
}

ROLE_ACTION_PATTERNS = {
    "推进者": ("下一步", "我们先", "决定", "确定", "开始", "分工", "推进"),
    "提问者": ("?", "？", "为什么", "如何", "怎么", "是否", "吗", "什么", "哪些"),
    "解释者": ("因为", "例如", "比如", "所以", "理由", "证据", "具体来说"),
    "质疑者": ("但是", "不过", "证据", "反例", "漏洞", "不一定", "是否", "为什么"),
    "总结者": ("总结", "共识", "分歧", "下一步", "目前", "我们已经"),
}


def _matches_role_action(role: str | None, content: str) -> bool:
    if not role or not content:
        return False
    patterns = ROLE_ACTION_PATTERNS.get(role, ())
    if any(pattern in content for pattern in patterns):
        return True
    return role == "解释者" and len(content.strip()) >= 40


def detect_role_action(
    role: str | None,
    messages: Iterable[dict[str, str]],
) -> dict[str, object]:
    """Detect whether a member has likely performed the current role action."""
    label = ROLE_ACTION_LABELS.get(role or "", "角色行动")
    for message in messages:
        content = message.get("content", "")
        if _matches_role_action(role, content):
            return {
                "observed": True,
                "label": label,
                "evidence_message_id": message.get("message_id"),
                "evidence_excerpt": content[:80],
            }
    return {
        "observed": False,
        "label": label,
        "evidence_message_id": None,
        "evidence_excerpt": "",
    }
