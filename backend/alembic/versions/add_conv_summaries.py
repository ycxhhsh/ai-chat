"""add conversation_summaries table

Revision ID: add_conv_summaries
Revises: dd282c79a94e
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_conv_summaries'
down_revision = 'dd282c79a94e'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'conversation_summaries',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(), nullable=False, index=True),
        sa.Column('conversation_id', sa.String(36), nullable=False, unique=True),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('conversation_summaries')
