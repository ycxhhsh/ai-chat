"""PostgreSQL JSONB 路径提取工具。

统一全项目的 JSON 列查询方式，消除 _jq 重复定义。

用法：
    from app.db.json_utils import jq
    jq(Message.sender, 'id')        # sender->>'id'
    jq(Message.sender, 'role')      # sender->>'role'
    jq(Message.metadata_info, 'scaffold_info', 'name')  # metadata_info->'scaffold_info'->>'name'
"""
from __future__ import annotations


def jq(column, *keys):
    """从 JSONB 列提取文本值（PostgreSQL ->> 操作符）。

    中间 key 用 -> 返回 JSON 对象，最后一个 key 用 ->> 返回文本。
    """
    if not keys:
        raise ValueError("jq() requires at least one key")
    col = column
    for key in keys[:-1]:
        col = col.op("->")(key)
    return col.op("->>")(keys[-1])
