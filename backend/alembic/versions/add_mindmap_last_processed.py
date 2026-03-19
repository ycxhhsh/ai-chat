"""Add last_processed_at to mindmaps table.

Enables incremental mindmap generation by tracking the timestamp
of the most recently processed message.

Revision ID: add_mindmap_last_processed
Revises: gin_jsonb_001
"""
revision = "add_mindmap_last_processed"
down_revision = "gin_jsonb_001"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.add_column(
        "mindmaps",
        sa.Column(
            "last_processed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("mindmaps", "last_processed_at")
