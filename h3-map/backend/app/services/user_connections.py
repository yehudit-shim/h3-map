"""User-defined connections and access grants, stored in the ``app`` metadata schema.

Passwords are encrypted with Fernet (key from ``H3MAP_ENCRYPTION_KEY``) before they are written, are never returned
by any function that feeds an API response, and are decrypted only to build the pool. The app database is a normal
(writable) database owned by this application; user data databases stay read-only.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

import psycopg
from cryptography.fernet import Fernet, InvalidToken
from psycopg.rows import dict_row

from ..errors import ApiError, not_found
from .connections import ConnectionDef

log = logging.getLogger("h3map.user_connections")
FIELDS = ("name", "host", "port", "database", "username", "sslmode", "max_pool_size", "statement_timeout_ms")


def new_key() -> str:
    return Fernet.generate_key().decode()


class UserConnectionStore:
    def __init__(self, database_url: str, encryption_key: str):
        self.url = database_url
        self.fernet = Fernet(encryption_key.encode())

    async def _conn(self) -> psycopg.AsyncConnection:
        try:
            return await psycopg.AsyncConnection.connect(self.url, autocommit=True, row_factory=dict_row, connect_timeout=5)
        except psycopg.Error as exc:
            log.warning("app database unreachable: %s", type(exc).__name__)
            raise ApiError(502, "db_unavailable", "The application database is not reachable.") from exc

    def _to_def(self, r: dict) -> ConnectionDef | None:
        try:
            pw = self.fernet.decrypt(bytes(r["password_enc"])).decode() if r["password_enc"] else ""
        except InvalidToken:
            log.error("cannot decrypt the password of connection %s (wrong H3MAP_ENCRYPTION_KEY?)", r["id"])
            return None
        return ConnectionDef(id=str(r["id"]), name=r["name"], host=r["host"], port=r["port"], database=r["database"],
                             username=r["username"], password=pw, sslmode=r["sslmode"], source="user",
                             statement_timeout_ms=r["statement_timeout_ms"], max_pool_size=r["max_pool_size"])

    async def list(self) -> list[ConnectionDef]:
        async with await self._conn() as c:
            rows = await (await c.execute("SELECT * FROM app.connections WHERE origin = 'user' ORDER BY name")).fetchall()
        return [d for d in map(self._to_def, rows) if d]

    async def create(self, f: dict[str, Any], password: str) -> ConnectionDef:
        enc = self.fernet.encrypt(password.encode())
        async with await self._conn() as c:
            try:
                r = await (await c.execute(
                    """INSERT INTO app.connections (name, host, port, database, username, password_enc, sslmode, max_pool_size,
                                                    statement_timeout_ms, origin)
                       VALUES (%(name)s, %(host)s, %(port)s, %(database)s, %(username)s, %(enc)s, %(sslmode)s, %(max_pool_size)s,
                               %(statement_timeout_ms)s, 'user') RETURNING *""", {**f, "enc": enc})).fetchone()
            except psycopg.errors.UniqueViolation:
                raise ApiError(409, "conflict", "A connection with this name already exists.")
        return self._to_def(r)  # type: ignore[return-value]

    async def update(self, cid: str, f: dict[str, Any], password: str | None) -> ConnectionDef:
        sets, params = [], {"id": _uuid(cid)}
        for k, v in f.items():
            if k in FIELDS:
                sets.append(f"{k} = %({k})s")
                params[k] = v
        if password is not None:
            sets.append("password_enc = %(enc)s")
            params["enc"] = self.fernet.encrypt(password.encode())
        if not sets:
            return await self.get(cid)
        async with await self._conn() as c:
            try:
                r = await (await c.execute(f"UPDATE app.connections SET {', '.join(sets)} WHERE id = %(id)s AND origin = 'user' RETURNING *", params)).fetchone()
            except psycopg.errors.UniqueViolation:
                raise ApiError(409, "conflict", "A connection with this name already exists.")
        if r is None:
            raise not_found("Unknown connection.", connectionId=cid)
        return self._to_def(r)  # type: ignore[return-value]

    async def get(self, cid: str) -> ConnectionDef:
        async with await self._conn() as c:
            r = await (await c.execute("SELECT * FROM app.connections WHERE id = %s AND origin = 'user'", (_uuid(cid),))).fetchone()
        d = self._to_def(r) if r else None
        if d is None:
            raise not_found("Unknown connection.", connectionId=cid)
        return d

    async def delete(self, cid: str) -> None:
        async with await self._conn() as c:
            r = await (await c.execute("DELETE FROM app.connections WHERE id = %s AND origin = 'user' RETURNING id", (_uuid(cid),))).fetchone()
        if r is None:
            raise not_found("Unknown connection.", connectionId=cid)

    # --- grants (subject = the ``sub`` claim of the token) -------------------------------------------------
    async def grants(self, cid: str) -> list[str]:
        async with await self._conn() as c:
            rows = await (await c.execute("SELECT subject FROM app.connection_grants WHERE connection_id = %s ORDER BY subject", (_uuid(cid),))).fetchall()
        return [r["subject"] for r in rows]

    async def set_grants(self, cid: str, subjects: list[str]) -> list[str]:
        u = _uuid(cid)
        async with await self._conn() as c:
            async with c.transaction():
                if await (await c.execute("SELECT 1 FROM app.connections WHERE id = %s AND origin = 'user'", (u,))).fetchone() is None:
                    raise not_found("Unknown connection.", connectionId=cid)
                await c.execute("DELETE FROM app.connection_grants WHERE connection_id = %s", (u,))
                for s in sorted(set(subjects)):
                    await c.execute("INSERT INTO app.connection_grants (connection_id, subject) VALUES (%s, %s)", (u, s))
        return sorted(set(subjects))


def _uuid(cid: str) -> uuid.UUID:
    try:
        return uuid.UUID(cid)
    except ValueError:
        raise not_found("Unknown connection.", connectionId=cid[:64])
