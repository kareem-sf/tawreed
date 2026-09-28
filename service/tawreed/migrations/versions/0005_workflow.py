"""The fixed workflow: no conversation. Projects pause with a reason and keep the engineer's Redo; each run records
its step; the messages and the agent's questions go.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("pause_reason", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("redo", sa.JSON(), nullable=True))
    op.execute("UPDATE projects SET paused = agent_paused")
    op.execute("UPDATE projects SET pause_reason = json_object('code', 'stopped') WHERE paused")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("agent_paused")
    with op.batch_alter_table("turns") as batch:
        batch.add_column(sa.Column("step", sa.String(8), nullable=True))
    op.execute("DELETE FROM decisions WHERE kind = 'question'")
    op.drop_table("messages")


def downgrade() -> None:
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
    with op.batch_alter_table("turns") as batch:
        batch.drop_column("step")
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("agent_paused", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE projects SET agent_paused = paused")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("redo")
        batch.drop_column("pause_reason")
        batch.drop_column("paused")
