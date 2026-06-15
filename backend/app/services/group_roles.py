"""Collaboration-role helpers for group teaching intervention."""
from __future__ import annotations

import random
from collections import Counter
from datetime import datetime, timezone
from typing import Iterable, Literal

AssignedBy = Literal["system", "teacher"]


COLLABORATION_ROLES: dict[str, dict[str, str]] = {
    "推进者": {
        "description": "推动小组确定下一步，帮助讨论继续向任务目标前进。",
        "prompt": "现在可以提醒小组确认一个下一步，或判断是否进入下一阶段。",
    },
    "提问者": {
        "description": "发现还不清楚的地方，用问题让讨论更深入。",
        "prompt": "你可以提出一个让大家解释原因、条件或证据的问题。",
    },
    "解释者": {
        "description": "把观点讲清楚，补充原因、例子、证据或操作步骤。",
        "prompt": "请尝试把一个观点展开说明，补充理由、例子或依据。",
    },
    "质疑者": {
        "description": "检查观点中的漏洞、反例和证据不足之处。",
        "prompt": "你可以指出一个还缺少证据、条件不完整或可能有反例的地方。",
    },
    "总结者": {
        "description": "阶段性归纳小组的共识、分歧和下一步。",
        "prompt": "请尝试总结目前已经达成的内容、仍有分歧的问题和下一步。",
    },
}


def choose_balanced_role(existing_roles: Iterable[str | None]) -> str:
    """Choose a role from the least-used roles in the current group."""
    valid_roles = set(COLLABORATION_ROLES)
    counts = Counter(role for role in existing_roles if role in valid_roles)
    min_count = min((counts.get(role, 0) for role in COLLABORATION_ROLES), default=0)
    candidates = [
        role for role in COLLABORATION_ROLES
        if counts.get(role, 0) == min_count
    ]
    return random.choice(candidates)


def assign_role_to_member(
    member,
    existing_roles: Iterable[str | None],
    assigned_by: AssignedBy = "system",
) -> str:
    """Assign and timestamp a balanced collaboration role on a GroupMember."""
    role = choose_balanced_role(existing_roles)
    member.collaboration_role = role
    member.role_assigned_by = assigned_by
    member.role_assigned_at = datetime.now(timezone.utc)
    return role


def role_payload(role: str | None) -> dict[str, str]:
    """Return UI-facing metadata for a collaboration role."""
    if role not in COLLABORATION_ROLES:
        return {"role": "", "description": "", "prompt": ""}
    return {
        "role": role,
        "description": COLLABORATION_ROLES[role]["description"],
        "prompt": COLLABORATION_ROLES[role]["prompt"],
    }
