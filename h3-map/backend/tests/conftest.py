from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import httpx
import psycopg
import pytest
import pytest_asyncio

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.auth.jwt import User, create_token  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.connections import ConnectionDef  # noqa: E402
from scripts.seed import fixtures as fx  # noqa: E402

from app.logging_setup import RedactingFilter  # noqa: E402

ADMIN_PW = "s3cret-admin-pw"


@pytest.fixture(scope="session")
def pg_server():
    """Fixture database `h3map_test`, created on the existing local PostgreSQL server (no Docker) and dropped at
    the end. The server's own databases are never touched. Requires H3MAP_TEST_ADMIN_DSN (superuser DSN); never hardcode it."""
    from psycopg.conninfo import conninfo_to_dict

    dsn = os.environ.get("H3MAP_TEST_ADMIN_DSN")
    if not dsn:
        pytest.exit("Set H3MAP_TEST_ADMIN_DSN to a superuser DSN of the local PostgreSQL server "
                    "(e.g. postgresql://user:password@localhost:5432/postgres). Tests create and drop a scratch database h3map_test.",
                    returncode=2)
    info = conninfo_to_dict(dsn)
    host, port = info.get("host", "localhost"), int(info.get("port", 5432))
    user, pw = info["user"], info.get("password", "")
    test_db = "h3map_test"
    with psycopg.connect(dsn, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {test_db} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {test_db}")
    admin_dsn = f"postgresql://{user}:{pw}@{host}:{port}/{test_db}"
    with psycopg.connect(admin_dsn, autocommit=True) as c:
        has_ext = c.execute("SELECT 1 FROM pg_available_extensions WHERE name='h3'").fetchone() is not None
        fx.build(c, with_h3_ext=has_ext)
    from alembic import command
    from alembic.config import Config
    os.environ["H3MAP_APP_DATABASE_URL"] = admin_dsn  # the app metadata schema lives in the scratch DB too
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")
    try:
        yield {"host": host, "port": port, "db": test_db, "admin_dsn": admin_dsn, "h3": has_ext,
               "admin_user": user, "admin_pw": pw}
    finally:
        with psycopg.connect(dsn, autocommit=True) as c:
            c.execute(f"DROP DATABASE IF EXISTS {test_db} WITH (FORCE)")


@pytest.fixture(scope="session")
def admin_dsn(pg_server):
    return pg_server["admin_dsn"]


@pytest.fixture(scope="session")
def has_h3_ext(pg_server):
    return pg_server["h3"]


@pytest.fixture(scope="session")
def settings(pg_server) -> Settings:
    from cryptography.fernet import Fernet
    return Settings(jwt_secret="test-secret-test-secret-test-secret", admin_password=ADMIN_PW, connections_file=None,
                    statement_timeout_ms=15_000, pool_timeout_s=5, app_database_url=pg_server["admin_dsn"],
                    encryption_key=Fernet.generate_key().decode())


def make_defs(pg_server) -> dict[str, ConnectionDef]:
    base = dict(host=pg_server["host"], port=pg_server["port"], database=pg_server["db"], sslmode="disable")
    return {
        "fixtures": ConnectionDef(id="fixtures", name="Fixtures", username="h3map_test_reader", password=fx.READER_PW, **base),
        "limited": ConnectionDef(id="limited", name="Limited", username="h3map_test_limited", password=fx.LIMITED_PW, **base),
        "admin": ConnectionDef(id="admin", name="Superuser", username=pg_server["admin_user"], password=pg_server["admin_pw"], **base),
        "restricted": ConnectionDef(id="restricted", name="Restricted", username="h3map_test_reader", password=fx.READER_PW,
                                    allowed_users=("alice",), **base),
        "down": ConnectionDef(id="down", name="Down", username="x", password="down-pw-123", host="127.0.0.1", port=1,
                              database="nodb", sslmode="disable"),
    }


@pytest_asyncio.fixture(scope="session")
async def app(pg_server, settings):
    app = create_app(settings, make_defs(pg_server))
    yield app
    await app.state.pools.close()


@pytest_asyncio.fixture(scope="session")
async def client(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


def token_for(settings: Settings, role: str, sub: str | None = None, ttl_s: int | None = None) -> str:
    return create_token(settings, User(sub=sub or f"{role}-user", role=role), ttl_s)


@pytest.fixture(scope="session")
def auth(settings):
    return {r: {"Authorization": f"Bearer {token_for(settings, r)}"} for r in ("viewer", "editor", "admin")}


@pytest.fixture
def H(auth):
    """Viewer headers."""
    return auth["viewer"]


@pytest.fixture
def caplog_all(caplog):
    caplog.set_level(logging.DEBUG)
    return caplog


@pytest.fixture(scope="session")
def live_server(pg_server, settings):
    """A real uvicorn server (own app instance, own pools) for sync clients and Hypothesis."""
    import socket
    import threading
    import time

    import uvicorn

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    server = uvicorn.Server(uvicorn.Config(create_app(settings, make_defs(pg_server)), host="127.0.0.1", port=port,
                                           log_level="warning", lifespan="on"))
    import asyncio

    def run():  # psycopg async needs a selector loop; uvicorn would pick the Proactor loop on Windows
        asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    t.join(timeout=10)
