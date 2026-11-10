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
os.environ.setdefault("TESTCONTAINERS_RYUK_DISABLED", "true")

from app.auth.jwt import User, create_token  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.connections import ConnectionDef  # noqa: E402
from scripts.seed import fixtures as fx  # noqa: E402

from app.logging_setup import RedactingFilter  # noqa: E402

DEFAULT_IMAGE = "anastasia-postgis-h3:17"  # local image with PostGIS + h3-pg; CI can use postgis/postgis:17-3.5
ADMIN_PW = "s3cret-admin-pw"


@pytest.fixture(scope="session")
def pg_server():
    """Throw-away PostGIS container with the deterministic fixtures. Yields connection facts."""
    from testcontainers.community.postgres import PostgresContainer

    image = os.environ.get("TEST_PG_IMAGE", DEFAULT_IMAGE)
    with PostgresContainer(image, username="postgres", password="postgres_admin_pw", dbname="fixtures") as pg:
        host, port = pg.get_container_host_ip(), int(pg.get_exposed_port(5432))
        admin_dsn = f"postgresql://postgres:postgres_admin_pw@{host}:{port}/fixtures"
        with psycopg.connect(admin_dsn, autocommit=True) as c:
            has_ext = c.execute("SELECT 1 FROM pg_available_extensions WHERE name='h3'").fetchone() is not None
            fx.build(c, with_h3_ext=has_ext)
        yield {"host": host, "port": port, "db": "fixtures", "admin_dsn": admin_dsn, "h3": has_ext,
               "container": pg}


@pytest.fixture(scope="session")
def admin_dsn(pg_server):
    return pg_server["admin_dsn"]


@pytest.fixture(scope="session")
def has_h3_ext(pg_server):
    return pg_server["h3"]


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(jwt_secret="test-secret-test-secret-test-secret", admin_password=ADMIN_PW, connections_file=None,
                    statement_timeout_ms=15_000, pool_timeout_s=5)


def make_defs(pg_server) -> dict[str, ConnectionDef]:
    base = dict(host=pg_server["host"], port=pg_server["port"], database=pg_server["db"], sslmode="disable")
    return {
        "fixtures": ConnectionDef(id="fixtures", name="Fixtures", username="gis_reader", password=fx.READER_PW, **base),
        "limited": ConnectionDef(id="limited", name="Limited", username="gis_limited", password=fx.LIMITED_PW, **base),
        "admin": ConnectionDef(id="admin", name="Superuser", username="postgres", password="postgres_admin_pw", **base),
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
