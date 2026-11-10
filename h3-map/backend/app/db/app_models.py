"""SQLAlchemy models for the ``app`` metadata schema (DATABASE_SCHEMA.md part A).

Phase 6A only creates the tables its design needs for connections and users. Saved layers, projects, settings and
the audit log belong to later phases and are intentionally absent. The data routes do not read this schema yet:
connections come from connections.yaml and the single admin from the environment.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "app"


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('viewer','editor','admin')", name="users_role_check"), {"schema": SCHEMA})
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text)
    external_sub: Mapped[str | None] = mapped_column(Text, unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Connection(Base):
    __tablename__ = "connections"
    __table_args__ = (CheckConstraint("port BETWEEN 1 AND 65535", name="connections_port_check"),
                      CheckConstraint("origin IN ('env','user')", name="connections_origin_check"), {"schema": SCHEMA})
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    host: Mapped[str] = mapped_column(Text, nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, server_default="5432")
    database: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    password_enc: Mapped[bytes | None] = mapped_column(LargeBinary)  # ciphertext only; the key lives outside the DB
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="1")
    sslmode: Mapped[str] = mapped_column(Text, nullable=False, server_default="require")
    read_only: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    max_pool_size: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="5")
    statement_timeout_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default="30000")
    origin: Mapped[str] = mapped_column(Text, nullable=False, server_default="user")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ConnectionGrant(Base):
    __tablename__ = "connection_grants"
    __table_args__ = {"schema": SCHEMA}
    connection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.connections.id", ondelete="CASCADE"), primary_key=True)
    subject: Mapped[str] = mapped_column(Text, primary_key=True)  # the JWT ``sub`` claim
