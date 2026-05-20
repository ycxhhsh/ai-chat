"""add learning space design tables

Revision ID: add_learning_space_design
Revises: add_convo_working_memory, add_conv_summaries
"""
from alembic import op
import sqlalchemy as sa


revision = "add_learning_space_design"
down_revision = ("add_convo_working_memory", "add_conv_summaries")
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "learning_space_questions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("stage_name", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled_steps", sa.JSON(), nullable=False),
        sa.Column("ai_round_limit", sa.Integer(), nullable=False),
        sa.Column("min_words_step1", sa.Integer(), nullable=False),
        sa.Column("min_words_step3", sa.Integer(), nullable=False),
        sa.Column("min_words_step5", sa.Integer(), nullable=False),
        sa.Column("allow_ai_acceleration", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_learning_space_questions_stage_name"),
        "learning_space_questions",
        ["stage_name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_learning_space_questions_created_by"),
        "learning_space_questions",
        ["created_by"],
        unique=False,
    )

    op.create_table(
        "learning_space_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=36), nullable=False),
        sa.Column("student_id", sa.String(length=36), nullable=False),
        sa.Column("group_id", sa.String(), nullable=True),
        sa.Column("current_step", sa.String(length=50), nullable=False),
        sa.Column("current_step_index", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("used_acceleration", sa.Boolean(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["learning_space_questions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "question_id",
            "student_id",
            name="uq_learning_space_question_student",
        ),
    )
    op.create_index(
        op.f("ix_learning_space_sessions_question_id"),
        "learning_space_sessions",
        ["question_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_learning_space_sessions_student_id"),
        "learning_space_sessions",
        ["student_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_learning_space_sessions_group_id"),
        "learning_space_sessions",
        ["group_id"],
        unique=False,
    )

    op.create_table(
        "learning_space_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("step_key", sa.String(length=50), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["learning_space_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "step_key",
            name="uq_learning_space_session_step_entry",
        ),
    )
    op.create_index(
        op.f("ix_learning_space_entries_session_id"),
        "learning_space_entries",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_learning_space_entries_step_key"),
        "learning_space_entries",
        ["step_key"],
        unique=False,
    )

    op.create_table(
        "learning_space_revisions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("entry_id", sa.String(length=36), nullable=False),
        sa.Column("old_content", sa.Text(), nullable=False),
        sa.Column("new_content", sa.Text(), nullable=False),
        sa.Column("edited_by", sa.String(length=36), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["entry_id"], ["learning_space_entries.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_learning_space_revisions_entry_id"),
        "learning_space_revisions",
        ["entry_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_learning_space_revisions_edited_by"),
        "learning_space_revisions",
        ["edited_by"],
        unique=False,
    )

    op.create_table(
        "learning_space_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("step_key", sa.String(length=50), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("round_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["learning_space_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_learning_space_messages_session_step_round",
        "learning_space_messages",
        ["session_id", "step_key", "round_index"],
        unique=False,
    )

    op.create_table(
        "learning_space_acceleration_checks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("step_key", sa.String(length=50), nullable=False),
        sa.Column("allowed", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("suggested_next_step", sa.String(length=50), nullable=True),
        sa.Column("adopted", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["learning_space_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_learning_space_acceleration_checks_session_id"),
        "learning_space_acceleration_checks",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_learning_space_acceleration_checks_step_key"),
        "learning_space_acceleration_checks",
        ["step_key"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_learning_space_acceleration_checks_step_key"),
        table_name="learning_space_acceleration_checks",
    )
    op.drop_index(
        op.f("ix_learning_space_acceleration_checks_session_id"),
        table_name="learning_space_acceleration_checks",
    )
    op.drop_table("learning_space_acceleration_checks")
    op.drop_index(
        "ix_learning_space_messages_session_step_round",
        table_name="learning_space_messages",
    )
    op.drop_table("learning_space_messages")
    op.drop_index(
        op.f("ix_learning_space_revisions_edited_by"),
        table_name="learning_space_revisions",
    )
    op.drop_index(
        op.f("ix_learning_space_revisions_entry_id"),
        table_name="learning_space_revisions",
    )
    op.drop_table("learning_space_revisions")
    op.drop_index(
        op.f("ix_learning_space_entries_step_key"),
        table_name="learning_space_entries",
    )
    op.drop_index(
        op.f("ix_learning_space_entries_session_id"),
        table_name="learning_space_entries",
    )
    op.drop_table("learning_space_entries")
    op.drop_index(
        op.f("ix_learning_space_sessions_group_id"),
        table_name="learning_space_sessions",
    )
    op.drop_index(
        op.f("ix_learning_space_sessions_student_id"),
        table_name="learning_space_sessions",
    )
    op.drop_index(
        op.f("ix_learning_space_sessions_question_id"),
        table_name="learning_space_sessions",
    )
    op.drop_table("learning_space_sessions")
    op.drop_index(
        op.f("ix_learning_space_questions_created_by"),
        table_name="learning_space_questions",
    )
    op.drop_index(
        op.f("ix_learning_space_questions_stage_name"),
        table_name="learning_space_questions",
    )
    op.drop_table("learning_space_questions")
