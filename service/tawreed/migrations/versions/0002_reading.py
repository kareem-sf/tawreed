"""Reading BOQ files: source status, pages, layouts and the item ledger

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sources") as batch:
        # Files added before reading existed are read on the next start.
        batch.add_column(sa.Column("status", sa.String(16), nullable=False, server_default="added"))
        batch.add_column(sa.Column("problem", sa.String(40), nullable=True))
    op.create_table(
        "source_pages",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_id", sa.String(32), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("has_text", sa.Boolean(), nullable=False),
        sa.Column("hidden", sa.Boolean(), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=True),
        sa.Column("cols", sa.Integer(), nullable=True),
        sa.Column("width", sa.Float(), nullable=True),
        sa.Column("height", sa.Float(), nullable=True),
        sa.UniqueConstraint("source_id", "number"),
    )
    op.create_index("ix_source_pages_source_id", "source_pages", ["source_id"])
    op.create_table(
        "layouts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_id", sa.String(32), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pages", sa.JSON(), nullable=False),
        sa.Column("spec", sa.JSON(), nullable=False),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column("decided_by", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_layouts_source_id", "layouts", ["source_id"])
    op.create_table(
        "items",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(32), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(40), nullable=False),
        sa.Column("quantity", sa.String(40), nullable=True),
        sa.Column("quantity_text", sa.String(80), nullable=False),
        sa.Column("rate", sa.String(40), nullable=True),
        sa.Column("rate_text", sa.String(80), nullable=False),
        sa.Column("amount", sa.String(40), nullable=True),
        sa.Column("amount_text", sa.String(80), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("headings", sa.JSON(), nullable=False),
        sa.Column("provenance", sa.JSON(), nullable=False),
        sa.Column("origin", sa.String(8), nullable=False),
        sa.Column("verify", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_items_project_id", "items", ["project_id"])
    op.create_index("ix_items_source_id", "items", ["source_id"])


def downgrade() -> None:
    op.drop_table("items")
    op.drop_table("layouts")
    op.drop_table("source_pages")
    with op.batch_alter_table("sources") as batch:
        batch.drop_column("problem")
        batch.drop_column("status")
