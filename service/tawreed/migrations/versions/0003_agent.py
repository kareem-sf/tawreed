"""The agent: item numbers, file relations, packages, decisions, the conversation, turns, consent and rules

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("agent_paused", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("package_numbers", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("sources") as batch:
        batch.add_column(sa.Column("relation", sa.String(16), nullable=True))
        batch.add_column(sa.Column("replaces_id", sa.String(32), nullable=True))
        batch.add_column(sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    # Items already extracted are numbered in the order they were stored, per project.
    with op.batch_alter_table("items") as batch:
        batch.add_column(sa.Column("ref", sa.Integer(), nullable=False, server_default="0"))
    op.execute(
        "UPDATE items SET ref = (SELECT COUNT(*) FROM items AS earlier "
        "WHERE earlier.project_id = items.project_id AND earlier.rowid <= items.rowid)"
    )
    with op.batch_alter_table("items") as batch:
        batch.create_unique_constraint("uq_items_project_id_ref", ["project_id", "ref"])

    op.create_table(
        "packages",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_packages_project_id", "packages", ["project_id"])
    op.create_table(
        "assignments",
        sa.Column("item_id", sa.String(32), sa.ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("package_id", sa.String(32), sa.ForeignKey("packages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("decided_by", sa.String(8), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_assignments_package_id", "assignments", ["package_id"])
    op.create_table(
        "rules",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_rules_project_id", "rules", ["project_id"])
    op.create_table(
        "decisions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("raised_by", sa.String(8), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("answer", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("answered_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_decisions_project_id", "decisions", ["project_id"])
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender", sa.String(8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("notice", sa.String(40), nullable=True),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_messages_project_id", "messages", ["project_id"])
    op.create_table(
        "turns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("ended", sa.String(16), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("calls", sa.JSON(), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
    )
    op.create_index("ix_turns_project_id", "turns", ["project_id"])
    op.create_table(
        "consents",
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("connection_id", sa.String(32), primary_key=True),
        sa.Column("granted_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    for table in ("consents", "turns", "messages", "decisions", "rules", "assignments", "packages"):
        op.drop_table(table)
    with op.batch_alter_table("items") as batch:
        batch.drop_constraint("uq_items_project_id_ref", type_="unique")
        batch.drop_column("ref")
    with op.batch_alter_table("sources") as batch:
        batch.drop_column("active")
        batch.drop_column("replaces_id")
        batch.drop_column("relation")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("package_numbers")
        batch.drop_column("agent_paused")
