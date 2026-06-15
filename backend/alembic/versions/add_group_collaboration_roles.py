"""add group collaboration roles

Revision ID: add_group_collaboration_roles
Revises: add_assignment_tasks_peer_review
"""
from alembic import op
import sqlalchemy as sa


revision = "add_group_collaboration_roles"
down_revision = "add_assignment_tasks_peer_review"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "group_members",
        sa.Column("collaboration_role", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "group_members",
        sa.Column("role_assigned_by", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "group_members",
        sa.Column("role_assigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "group_role_objections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("group_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("current_role", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.String(length=100), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("resolved_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_group_role_objections_group_id"),
        "group_role_objections",
        ["group_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_group_role_objections_user_id"),
        "group_role_objections",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_group_role_objections_status"),
        "group_role_objections",
        ["status"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_group_role_objections_status"),
        table_name="group_role_objections",
    )
    op.drop_index(
        op.f("ix_group_role_objections_user_id"),
        table_name="group_role_objections",
    )
    op.drop_index(
        op.f("ix_group_role_objections_group_id"),
        table_name="group_role_objections",
    )
    op.drop_table("group_role_objections")
    op.drop_column("group_members", "role_assigned_at")
    op.drop_column("group_members", "role_assigned_by")
    op.drop_column("group_members", "collaboration_role")
