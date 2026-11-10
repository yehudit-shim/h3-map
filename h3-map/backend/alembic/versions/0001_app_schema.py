"""app schema: users, connections, connection_grants

Revision ID: 0001
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None
S = "app"


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {S}")
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.Text, nullable=False, unique=True),
        sa.Column("display_name", sa.Text),
        sa.Column("external_sub", sa.Text, unique=True),
        sa.Column("password_hash", sa.Text),
        sa.Column("role", sa.Text, nullable=False, server_default="viewer"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("role IN ('viewer','editor','admin')", name="users_role_check"),
        schema=S)
    op.create_table(
        "connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text, nullable=False, unique=True),
        sa.Column("host", sa.Text, nullable=False),
        sa.Column("port", sa.Integer, nullable=False, server_default="5432"),
        sa.Column("database", sa.Text, nullable=False),
        sa.Column("username", sa.Text, nullable=False),
        sa.Column("password_enc", sa.LargeBinary),
        sa.Column("key_version", sa.SmallInteger, nullable=False, server_default="1"),
        sa.Column("sslmode", sa.Text, nullable=False, server_default="require"),
        sa.Column("read_only", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("max_pool_size", sa.SmallInteger, nullable=False, server_default="5"),
        sa.Column("statement_timeout_ms", sa.Integer, nullable=False, server_default="30000"),
        sa.Column("origin", sa.Text, nullable=False, server_default="user"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey(f"{S}.users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("port BETWEEN 1 AND 65535", name="connections_port_check"),
        sa.CheckConstraint("origin IN ('env','user')", name="connections_origin_check"),
        schema=S)
    op.create_table(
        "connection_grants",
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey(f"{S}.connections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey(f"{S}.users.id", ondelete="CASCADE"), primary_key=True),
        schema=S)


def downgrade() -> None:
    op.drop_table("connection_grants", schema=S)
    op.drop_table("connections", schema=S)
    op.drop_table("users", schema=S)
