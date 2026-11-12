"""Sign in with a PostgreSQL role: the username and password are checked by PostgreSQL itself.

The server opens a connection to the application database (host, port, database and SSL mode of
``H3MAP_APP_DATABASE_URL`` / the first-run setup) using the *submitted* credentials. If PostgreSQL accepts them the
user is authenticated; nothing else is stored and the password is not kept. The app role comes from the PostgreSQL role:

* superuser, or member of the PostgreSQL role ``pg_admin_role`` (default ``h3map_admin``)  -> admin
* member of ``pg_editor_role`` (default ``h3map_editor``)                                    -> editor
* anything else                                                                              -> ``pg_default_role`` (viewer)

Manage access in SQL, e.g. ``CREATE ROLE h3map_admin; GRANT h3map_admin TO alice;``.
Data access is unchanged: queries still run through the connection's own service account, not the signed-in role.
"""
from __future__ import annotations

import logging

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

from ..config import Settings
from ..errors import ApiError
from .jwt import User

log = logging.getLogger("h3map.pg_auth")
# PostgreSQL answers a bad name, bad password, NOLOGIN role or a pg_hba.conf rejection with one of these.
_DENIED_SQLSTATES = {"28P01", "28000"}
_DENIED_TEXT = ("authentication failed", "no pg_hba.conf entry", "is not permitted to log in", "does not exist")

_ROLE_SQL = """
SELECT r.rolsuper AS su,
       COALESCE((SELECT bool_or(pg_has_role(current_user, g.oid, 'MEMBER')) FROM pg_roles g WHERE g.rolname = %(admin)s), false) AS adm,
       COALESCE((SELECT bool_or(pg_has_role(current_user, g.oid, 'MEMBER')) FROM pg_roles g WHERE g.rolname = %(editor)s), false) AS ed
  FROM pg_roles r WHERE r.rolname = current_user
"""


def enabled(settings: Settings) -> bool:
    return settings.pg_auth_enabled and settings.app_database_url is not None


async def authenticate(settings: Settings, username: str, password: str) -> User | None:
    """The user for a PostgreSQL role PostgreSQL accepts, None for wrong credentials; ApiError 502 if the server is down."""
    if not enabled(settings) or not username or not password or "\u0000" in username + password:
        return None
    params = conninfo_to_dict(settings.app_database_url.get_secret_value())  # type: ignore[union-attr]
    params.update(user=username, password=password, connect_timeout=5, application_name="h3map-login")
    try:
        conn = await psycopg.AsyncConnection.connect(**params, autocommit=True, row_factory=dict_row)
    except psycopg.OperationalError as exc:
        text = str(exc).lower()
        if getattr(exc, "sqlstate", None) in _DENIED_SQLSTATES or any(t in text for t in _DENIED_TEXT):
            return None
        log.warning("postgres login unavailable: %s", type(exc).__name__)
        raise ApiError(502, "db_unavailable", "The database server is not reachable.") from exc
    async with conn:
        r = await (await conn.execute(_ROLE_SQL, {"admin": settings.pg_admin_role, "editor": settings.pg_editor_role})).fetchone()
    role = "admin" if r["su"] or r["adm"] else "editor" if r["ed"] else settings.pg_default_role
    return User(sub=username, role=role)
