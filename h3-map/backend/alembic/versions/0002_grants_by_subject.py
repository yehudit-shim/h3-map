"""connection_grants keyed by token subject instead of users.id

The built-in login has no rows in app.users, so grants reference the ``sub`` claim of the JWT.
Revision ID: 0002
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None
S = "app"


def upgrade() -> None:
    op.drop_table("connection_grants", schema=S)
    op.create_table(
        "connection_grants",
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey(f"{S}.connections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("subject", sa.Text, primary_key=True),
        schema=S)


def downgrade() -> None:
    op.drop_table("connection_grants", schema=S)
    op.create_table(
        "connection_grants",
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey(f"{S}.connections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey(f"{S}.users.id", ondelete="CASCADE"), primary_key=True),
        schema=S)
