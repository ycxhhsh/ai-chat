"""启动时自动注册 student.xlsx 名单中的用户（杨晨为教师）。"""
from __future__ import annotations

import logging

from app.core.security import hash_password

logger = logging.getLogger(__name__)

# 学号, 姓名, 角色
_ROSTER = [
    ("302023572001", "苏俊林", "student"),
    ("302023572013", "张怡", "student"),
    ("302023572017", "曹文杰", "student"),
    ("302023572029", "林明鉴", "student"),
    ("302023572031", "唐麟云", "student"),
    ("302023572034", "尹心怡", "student"),
    ("302023572035", "叶依颖", "student"),
    ("302023572038", "张家旗", "student"),
    ("302023572042", "夏也淑", "student"),
    ("302023572044", "洪恺", "student"),
    ("302023572046", "范明宇", "student"),
    ("302023572050", "洪振毓", "student"),
    ("302023572053", "胡宇轩", "student"),
    ("302023572066", "姚馨雅", "student"),
    ("302023572068", "龚杨烯", "student"),
    ("302023572069", "李承翰", "student"),
    ("302023572074", "姚毅豪", "student"),
    ("302023572079", "胡涵之", "student"),
    ("302023572084", "李骋川", "student"),
    ("302023572086", "徐子恒", "student"),
    ("302023572091", "任浩翔", "student"),
    ("302023572093", "高泽凡", "student"),
    ("302023572094", "张文哲", "student"),
    ("302023572098", "黄依琪", "student"),
    ("302023572101", "潘敬翰", "student"),
    ("302023572115", "汪婧瑜", "student"),
    ("302023572119", "赵弈文", "student"),
    ("302023572136", "杨北楠", "student"),
    ("302023572140", "徐明轩", "student"),
    ("302023572147", "李日翱", "student"),
    ("302023572148", "潘天芸", "student"),
    ("302023572153", "徐灏", "student"),
    ("302023572159", "朱俊杰", "student"),
    ("302023572160", "金科", "student"),
    ("302023572169", "杨晨", "teacher"),       # ← 教师
    ("302023572175", "黄奕萱", "student"),
]


async def seed_roster() -> None:
    """批量注册名单中的用户（已存在则跳过）。"""
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from sqlalchemy import select

    default_pwd_hash = hash_password("123456")
    created = 0

    async with AsyncSessionLocal() as db:
        for sid, name, role in _ROSTER:
            email = f"{sid}@stu.edu"
            existing = await db.execute(
                select(User).where(User.email == email)
            )
            if existing.scalar_one_or_none():
                continue

            db.add(User(
                email=email,
                password_hash=default_pwd_hash,
                name=name,
                role=role,
            ))
            created += 1

        if created:
            await db.commit()
            logger.info("Seeded %d users from roster", created)
