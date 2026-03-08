"""Alter messages JSONB columns and add GIN indexes.

Converts sender, timing, metadata_info from JSON to JSONB,
then creates GIN indexes for query acceleration.

Revision ID: gin_jsonb_001
Revises: add_conv_summaries
"""
revision = "gin_jsonb_001"
down_revision = "add_conv_summaries"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    # Step 1: 将 JSON 列转换为 JSONB（PostgreSQL 原生支持 USING 强制转换）
    op.execute(
        "ALTER TABLE messages "
        "ALTER COLUMN sender TYPE jsonb USING sender::jsonb"
    )
    op.execute(
        "ALTER TABLE messages "
        "ALTER COLUMN timing TYPE jsonb USING timing::jsonb"
    )
    op.execute(
        "ALTER TABLE messages "
        "ALTER COLUMN metadata_info TYPE jsonb USING metadata_info::jsonb"
    )

    # Step 2: GIN (jsonb_path_ops) 索引
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_messages_sender_gin "
        "ON messages USING gin (sender jsonb_path_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_messages_metadata_gin "
        "ON messages USING gin (metadata_info jsonb_path_ops)"
    )
    # Step 3: 表达式索引 — 加速 sender->>'role' 精确匹配
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_messages_sender_role "
        "ON messages ((sender->>'role'))"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_messages_sender_role")
    op.execute("DROP INDEX IF EXISTS ix_messages_metadata_gin")
    op.execute("DROP INDEX IF EXISTS ix_messages_sender_gin")

    # 还原为 JSON
    op.execute(
        "ALTER TABLE messages "
        "ALTER COLUMN sender TYPE json USING sender::json"
    )
    op.execute(
        "ALTER TABLE messages "
        "ALTER COLUMN timing TYPE json USING timing::json"
    )
    op.execute(
        "ALTER TABLE messages "
        "ALTER COLUMN metadata_info TYPE json USING metadata_info::json"
    )
