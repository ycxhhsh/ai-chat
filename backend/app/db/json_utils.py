"""PostgreSQL JSONB 路径提取工具。

统一全项目的 JSON 列查询方式，消除 _jq 重复定义。

用法：
    from app.db.json_utils import jq
    jq(Message.sender, 'id')        # sender->>'id'
    jq(Message.sender, 'role')      # sender->>'role'
    jq(Message.metadata_info, 'scaffold_info', 'name')  # metadata_info->'scaffold_info'->>'name'
"""
from __future__ import annotations

from sqlalchemy import String, cast, func


def jq(column, *keys):
    """Extract nested JSON keys as text across PostgreSQL and SQLite."""
    if not keys:
        raise ValueError("jq() requires at least one key")
    expr = column
    for key in keys:
        expr = expr[key]
    return expr.as_string()


def jq_truthy(column, *keys):
    """Match JSON booleans stored as true/1 or as string values."""
    return func.lower(cast(jq(column, *keys), String)).in_(("true", "1"))
