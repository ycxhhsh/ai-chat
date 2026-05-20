"""add assignment tasks and peer review tables

Revision ID: add_assignment_tasks_peer_review
Revises: add_learning_space_design
"""
from alembic import op
import sqlalchemy as sa


revision = "add_assignment_tasks_peer_review"
down_revision = "add_learning_space_design"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "assignment_tasks",
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("peer_review_count", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("peer_review_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("task_id"),
    )
    op.create_index(
        op.f("ix_assignment_tasks_created_by"),
        "assignment_tasks",
        ["created_by"],
        unique=False,
    )

    op.add_column(
        "assignments",
        sa.Column("task_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        op.f("ix_assignments_task_id"),
        "assignments",
        ["task_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_assignments_task_id_assignment_tasks",
        "assignments",
        "assignment_tasks",
        ["task_id"],
        ["task_id"],
    )
    op.create_unique_constraint(
        "uq_assignment_task_student",
        "assignments",
        ["task_id", "student_id"],
    )

    op.create_table(
        "assignment_task_targets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("student_id", sa.String(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["assignment_tasks.task_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "student_id", name="uq_assignment_task_target"),
    )
    op.create_index(
        op.f("ix_assignment_task_targets_task_id"),
        "assignment_task_targets",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assignment_task_targets_student_id"),
        "assignment_task_targets",
        ["student_id"],
        unique=False,
    )

    op.create_table(
        "assignment_self_reviews",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("assignment_id", sa.String(length=36), nullable=False),
        sa.Column("student_id", sa.String(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.assignment_id"]),
        sa.ForeignKeyConstraint(["task_id"], ["assignment_tasks.task_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "student_id", name="uq_self_review_task_student"),
    )
    op.create_index(
        op.f("ix_assignment_self_reviews_task_id"),
        "assignment_self_reviews",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assignment_self_reviews_assignment_id"),
        "assignment_self_reviews",
        ["assignment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assignment_self_reviews_student_id"),
        "assignment_self_reviews",
        ["student_id"],
        unique=False,
    )

    op.create_table(
        "assignment_peer_reviews",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("assignment_id", sa.String(length=36), nullable=False),
        sa.Column("reviewer_id", sa.String(), nullable=False),
        sa.Column("reviewee_id", sa.String(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.assignment_id"]),
        sa.ForeignKeyConstraint(["task_id"], ["assignment_tasks.task_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id",
            "reviewer_id",
            "assignment_id",
            name="uq_peer_review_task_reviewer_assignment",
        ),
    )
    op.create_index(
        op.f("ix_assignment_peer_reviews_task_id"),
        "assignment_peer_reviews",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assignment_peer_reviews_assignment_id"),
        "assignment_peer_reviews",
        ["assignment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assignment_peer_reviews_reviewer_id"),
        "assignment_peer_reviews",
        ["reviewer_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assignment_peer_reviews_reviewee_id"),
        "assignment_peer_reviews",
        ["reviewee_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_assignment_peer_reviews_reviewee_id"),
        table_name="assignment_peer_reviews",
    )
    op.drop_index(
        op.f("ix_assignment_peer_reviews_reviewer_id"),
        table_name="assignment_peer_reviews",
    )
    op.drop_index(
        op.f("ix_assignment_peer_reviews_assignment_id"),
        table_name="assignment_peer_reviews",
    )
    op.drop_index(
        op.f("ix_assignment_peer_reviews_task_id"),
        table_name="assignment_peer_reviews",
    )
    op.drop_table("assignment_peer_reviews")
    op.drop_index(
        op.f("ix_assignment_self_reviews_student_id"),
        table_name="assignment_self_reviews",
    )
    op.drop_index(
        op.f("ix_assignment_self_reviews_assignment_id"),
        table_name="assignment_self_reviews",
    )
    op.drop_index(
        op.f("ix_assignment_self_reviews_task_id"),
        table_name="assignment_self_reviews",
    )
    op.drop_table("assignment_self_reviews")
    op.drop_index(
        op.f("ix_assignment_task_targets_student_id"),
        table_name="assignment_task_targets",
    )
    op.drop_index(
        op.f("ix_assignment_task_targets_task_id"),
        table_name="assignment_task_targets",
    )
    op.drop_table("assignment_task_targets")
    op.drop_constraint(
        "uq_assignment_task_student",
        "assignments",
        type_="unique",
    )
    op.drop_constraint(
        "fk_assignments_task_id_assignment_tasks",
        "assignments",
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_assignments_task_id"), table_name="assignments")
    op.drop_column("assignments", "task_id")
    op.drop_index(
        op.f("ix_assignment_tasks_created_by"),
        table_name="assignment_tasks",
    )
    op.drop_table("assignment_tasks")
