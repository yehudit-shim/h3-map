"""First-run setup: point the server at its application database and create the first admin, from the UI.

Public routes (there is nobody to sign in yet), so they are locked down twice: they only work while the server
``needs_setup`` (no application DB configured yet), and every mutating call needs the one-time setup
token that the server prints to its log at start-up (``app.state.setup_token``).
"""
from __future__ import annotations

import asyncio
import hmac
import logging
from pathlib import Path
from typing import Literal

import psycopg
from alembic import command
from alembic.config import Config
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy.engine import URL

from ... import bootstrap
from ...config import Settings, get_settings
from ...errors import ApiError
from ...logging_setup import register_secret
from ...services.users import UserStore

router = APIRouter(prefix="/setup", tags=["setup"])
log = logging.getLogger("h3map.setup")
SSL = Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]
_BACKEND = Path(__file__).resolve().parents[3]


class DbBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    host: str = Field(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9._:-]+$")
    port: int = Field(5432, ge=1, le=65535)
    database: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(max_length=256)
    sslmode: SSL = "prefer"


class AdminBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(min_length=8, max_length=256)


class TestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    setupToken: SecretStr
    database: DbBody


class SetupBody(TestBody):
    admin: AdminBody


def _url(d: DbBody) -> str:
    return URL.create("postgresql", d.username, d.password.get_secret_value(), d.host, d.port, d.database,
                      {"sslmode": d.sslmode}).render_as_string(hide_password=False)


def _connect_check(url: str) -> None:
    try:
        with psycopg.connect(url, connect_timeout=5) as c:
            c.execute("SELECT 1")
    except psycopg.Error as exc:
        log.warning("setup: cannot connect to the application database: %s", type(exc).__name__)
        raise ApiError(400, "db_connect_failed", "Could not connect to the database. Check host, port, database, user, password and SSL mode.") from exc


def _migrate(url: str) -> None:
    cfg = Config(str(_BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))  # ConfigParser interpolation
    try:
        command.upgrade(cfg, "head")
    except Exception as exc:  # noqa: BLE001 - surfaced as one fixed message; details are logged
        log.error("setup: migration failed: %s", type(exc).__name__)
        raise ApiError(400, "migration_failed", "The database was reachable but the schema could not be created. "
                       "The user needs permission to CREATE SCHEMA and CREATE TABLE in that database.") from exc


async def needs_setup(app, s: Settings) -> bool:
    """True while no application database is configured (and no env admin). Once it is, nobody can claim the server:
    PostgreSQL roles (and app.users accounts) can sign in, so setup closes for good."""
    if s.admin_password is not None or s.admin_password_hash:
        return False  # an explicit env admin was configured: the classic setup, nothing to claim
    return app.state.user_store is None


def _guard_token(request: Request, token: SecretStr) -> None:
    expected = request.app.state.setup_token
    if not hmac.compare_digest(token.get_secret_value().encode(), expected.encode()):
        raise ApiError(403, "forbidden", "Wrong setup token. It is printed in the server log when the server starts.")


@router.get("/status")
async def status(request: Request, s: Settings = Depends(get_settings)) -> dict:
    return {"needsSetup": await needs_setup(request.app, s)}


@router.post("/test-database")
async def test_database(body: TestBody, request: Request, s: Settings = Depends(get_settings)) -> dict:
    if not await needs_setup(request.app, s):
        raise ApiError(409, "conflict", "The server is already set up.")
    _guard_token(request, body.setupToken)
    await asyncio.to_thread(_connect_check, _url(body.database))
    return {"ok": True}


@router.post("", status_code=201)
async def run_setup(body: SetupBody, request: Request, s: Settings = Depends(get_settings)) -> dict:
    if not await needs_setup(request.app, s):
        raise ApiError(409, "conflict", "The server is already set up.")
    _guard_token(request, body.setupToken)
    url = _url(body.database)
    register_secret(body.database.password.get_secret_value())
    register_secret(body.admin.password.get_secret_value())
    await asyncio.to_thread(_connect_check, url)
    await asyncio.to_thread(_migrate, url)
    users = UserStore(url)
    adopted = await users.has_active_user()  # re-pointing the server at a database that is already in use
    if not adopted:
        if await users.has_any_user():
            raise ApiError(409, "conflict", "The database has users but none is active. Reactivate one directly in the database.")
        await users.create(body.admin.username, body.admin.password.get_secret_value(), "admin", None)
    bootstrap.save_app_db_url(url)
    # Switch the running server over: no restart needed.
    from ...services.user_connections import UserConnectionStore
    s.app_database_url = SecretStr(url)
    key = s.encryption_key.get_secret_value() if s.encryption_key else bootstrap.fernet_key()
    s.encryption_key = SecretStr(key)
    register_secret(url)
    request.app.state.user_store = users
    pools = request.app.state.pools
    pools.store = UserConnectionStore(url, key)
    try:
        await pools.load_user_defs()
    except ApiError:
        log.warning("setup: could not load saved connections")
    log.info("setup completed (%s)", "existing users adopted" if adopted else f"first admin {body.admin.username!r} created")
    return {"ok": True, "adopted": adopted}
