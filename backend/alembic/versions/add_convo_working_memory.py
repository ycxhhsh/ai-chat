"""Add working_memory and msg_count_at_summary to ai_conversations.

Revision ID: add_convo_working_memory
Revises: add_mindmap_last_processed
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_convo_working_memory'
down_revision = 'add_mindmap_last_processed'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'ai_conversations',
        sa.Column('working_memory', sa.Text(), nullable=True)
    )
    op.add_column(
        'ai_conversations',
        sa.Column('msg_count_at_summary', sa.Integer(), nullable=False, server_default='0')
    )


def downgrade():
    op.drop_column('ai_conversations', 'msg_count_at_summary')
    op.drop_column('ai_conversations', 'working_memory')
