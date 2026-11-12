"""Database-backed users (``app.users``): password login and user administration.

The login name is stored in the ``email`` column (any unique string is accepted, an e-mail address is the convention).
Passwords are stored only as PBKDF2 hashes (``app.auth.jwt.hash_password``). The local admin from the environment stays
as break-glass and is never stored here.
"""
from __future__ import annotations

import logging
import uuid

import psycopg
from psycopg.rows import dict_row

from ..auth.jwt import User, hash_password, verify_hash
from ..errors import ApiError, not_found

log = logging.getLogger("h3map.users")
_DUMMY_HASH = hash_password("dummy-password-for-constant-time")  # verified when the user does not exist
_PUBLIC = "id, email, display_name, role, is_active, created_at, last_login_at"


def _public(r: dict) -> dict:
    return {"id": str(r["id"]), "username": r["email"], "displayName": r["display_name"], "role": r["role"],
            "active": r["is_active"], "createdAt": r["created_at"].isoformat(),
            "lastLoginAt": r["last_login_at"].isoformat() if r["last_login_at"] else None}


def _uuid(v: str) -> uuid.UUID:
    try:
        return uuid.UUID(v)
    except ValueError:
        raise not_found("User")


class UserStore:
    def __init__(self, database_url: str):
        self.url = database_url

    async def _conn(self) -> psycopg.AsyncConnection:
        try:
            return await psycopg.AsyncConnection.connect(self.url, autocommit=True, row_factory=dict_row, connect_timeout=5)
        except psycopg.Error as exc:
            log.warning("app database unreachable: %s", type(exc).__name__)
            raise ApiError(502, "db_unavailable", "The application database is not reachable.") from exc

    async def authenticate(self, username: str, password: str) -> User | None:
        """Return the user for valid credentials of an active account, else None (same cost either way)."""
        if "\u0000" in username:  # PostgreSQL text cannot hold NUL; such a name cannot exist
            return None
        async with await self._conn() as c:
            r = await (await c.execute("SELECT id, email, password_hash, role, is_active FROM app.users WHERE lower(email) = lower(%s)",
                                       (username.strip(),))).fetchone()
            ok = verify_hash(password, r["password_hash"] if r and r["password_hash"] else _DUMMY_HASH)
            if not (r and ok and r["is_active"] and r["password_hash"]):
                return None
            await c.execute("UPDATE app.users SET last_login_at = now() WHERE id = %s", (r["id"],))
        return User(sub=r["email"], role=r["role"])

    async def has_any_user(self) -> bool:
        async with await self._conn() as c:
            r = await (await c.execute("SELECT EXISTS (SELECT 1 FROM app.users)")).fetchone()
        return bool(r["exists"])

    async def has_active_user(self) -> bool:
        """True when somebody can sign in with a password (used to decide whether first-run setup is still open)."""
        try:
            async with await self._conn() as c:
                r = await (await c.execute("SELECT EXISTS (SELECT 1 FROM app.users WHERE is_active AND password_hash IS NOT NULL)")).fetchone()
        except psycopg.errors.UndefinedTable:  # database reachable but not migrated yet
            return False
        return bool(r["exists"])

    async def list(self) -> list[dict]:
        async with await self._conn() as c:
            return [_public(r) for r in await (await c.execute(f"SELECT {_PUBLIC} FROM app.users ORDER BY email")).fetchall()]

    async def create(self, username: str, password: str, role: str, display_name: str | None) -> dict:
        async with await self._conn() as c:
            try:
                r = await (await c.execute(
                    f"INSERT INTO app.users (email, display_name, password_hash, role) VALUES (%s, %s, %s, %s) RETURNING {_PUBLIC}",
                    (username.strip(), display_name, hash_password(password), role))).fetchone()
            except psycopg.errors.UniqueViolation:
                raise ApiError(409, "conflict", "A user with this name already exists.")
        return _public(r)

    async def update(self, uid: str, fields: dict, password: str | None) -> dict:
        cols = {"role": "role", "displayName": "display_name", "active": "is_active"}
        sets, params = [], {"id": _uuid(uid)}
        for k, col in cols.items():
            if fields.get(k) is not None:
                sets.append(f"{col} = %({col})s")
                params[col] = fields[k]
        if password is not None:
            sets.append("password_hash = %(ph)s")
            params["ph"] = hash_password(password)
        async with await self._conn() as c:
            if sets:
                r = await (await c.execute(f"UPDATE app.users SET {', '.join(sets)} WHERE id = %(id)s RETURNING {_PUBLIC}", params)).fetchone()
            else:
                r = await (await c.execute(f"SELECT {_PUBLIC} FROM app.users WHERE id = %(id)s", params)).fetchone()
        if r is None:
            raise not_found("User")
        return _public(r)

    async def delete(self, uid: str) -> None:
        async with await self._conn() as c:
            cur = await c.execute("DELETE FROM app.users WHERE id = %s", (_uuid(uid),))
            if cur.rowcount == 0:
                raise not_found("User")
