"""First-run setup: needs_setup lock, one-time token, migration, first admin, hot switch-over, persistence."""
import uuid

import httpx
import psycopg
import pytest
import pytest_asyncio

from app.config import Settings
from app.main import create_app

ADMIN_PW = "first-admin-password"


@pytest.fixture
def scratch_db(pg_server):
    name = f"h3map_setup_{uuid.uuid4().hex[:8]}"
    root = f"postgresql://{pg_server['admin_user']}:{pg_server['admin_pw']}@{pg_server['host']}:{pg_server['port']}/postgres"
    with psycopg.connect(root, autocommit=True) as c:
        c.execute(f"CREATE DATABASE {name}")
    yield {"host": pg_server["host"], "port": pg_server["port"], "database": name, "username": pg_server["admin_user"],
           "password": pg_server["admin_pw"], "sslmode": "prefer"}
    with psycopg.connect(root, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


@pytest_asyncio.fixture
async def fresh(tmp_path, monkeypatch):
    """An app with no env admin, no application database and an empty data directory."""
    monkeypatch.setenv("H3MAP_DATA_DIR", str(tmp_path))
    settings = Settings(_env_file=None, jwt_secret="t" * 40, connections_file=None, admin_password=None, app_database_url=None, encryption_key=None)
    app = create_app(settings, {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield app, c, tmp_path
    await app.state.pools.close()


def body(app, db, token=None, username="boss", password=ADMIN_PW):
    return {"setupToken": token or app.state.setup_token, "database": db, "admin": {"username": username, "password": password}}


async def test_setup_open_until_done(fresh, scratch_db):
    app, c, data = fresh
    assert (await c.get("/api/v1/setup/status")).json() == {"needsSetup": True}
    assert (await c.post("/api/v1/auth/login", json={"username": "boss", "password": ADMIN_PW})).status_code == 401

    r = await c.post("/api/v1/setup", json=body(app, scratch_db))
    assert r.status_code == 201 and r.json() == {"ok": True, "adopted": False}
    assert (await c.get("/api/v1/setup/status")).json() == {"needsSetup": False}

    login = await c.post("/api/v1/auth/login", json={"username": "boss", "password": ADMIN_PW})  # no restart needed
    assert login.status_code == 200 and login.json()["role"] == "admin"
    h = {"Authorization": f"Bearer {login.json()['accessToken']}"}
    assert (await c.get("/api/v1/config", headers=h)).json()["featureFlags"]["userConnections"] is True

    # locked afterwards, even with the right token
    again = await c.post("/api/v1/setup", json=body(app, scratch_db, username="mallory"))
    assert again.status_code == 409
    assert (await c.post("/api/v1/setup/test-database", json={"setupToken": app.state.setup_token, "database": scratch_db})).status_code == 409

    # the URL is persisted encrypted, never in clear text
    enc = (data / "app_db.enc").read_bytes()
    assert scratch_db["database"].encode() not in enc and scratch_db["password"].encode() not in enc
    assert (data / "secret.key").exists()


async def test_wrong_token_is_refused_and_changes_nothing(fresh, scratch_db):
    app, c, data = fresh
    r = await c.post("/api/v1/setup", json=body(app, scratch_db, token="guess"))
    assert r.status_code == 403
    assert (await c.get("/api/v1/setup/status")).json() == {"needsSetup": True}
    assert not (data / "app_db.enc").exists()


async def test_bad_database_credentials_give_a_fixed_message(fresh, scratch_db):
    app, c, _ = fresh
    r = await c.post("/api/v1/setup/test-database", json={"setupToken": app.state.setup_token, "database": {**scratch_db, "password": "wrong"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "db_connect_failed"
    assert "wrong" not in r.text and scratch_db["host"] not in r.text.replace("Check host", "")
    ok = await c.post("/api/v1/setup/test-database", json={"setupToken": app.state.setup_token, "database": scratch_db})
    assert ok.status_code == 200


async def test_short_admin_password_is_rejected_before_anything_happens(fresh, scratch_db):
    app, c, data = fresh
    r = await c.post("/api/v1/setup", json=body(app, scratch_db, password="short"))
    assert r.status_code == 422 and not (data / "app_db.enc").exists()


async def test_existing_database_with_an_active_user_is_adopted(fresh, scratch_db):
    app, c, _ = fresh
    assert (await c.post("/api/v1/setup", json=body(app, scratch_db))).status_code == 201
    # second server, same database, empty data directory: no new admin is created, existing users keep working
    settings = Settings(_env_file=None, jwt_secret="u" * 40, connections_file=None, admin_password=None, app_database_url=None, encryption_key=None)
    app2 = create_app(settings, {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app2), base_url="http://test") as c2:
        r = await c2.post("/api/v1/setup", json=body(app2, scratch_db, username="other"))
        assert r.status_code == 201 and r.json()["adopted"] is True
        assert (await c2.post("/api/v1/auth/login", json={"username": "boss", "password": ADMIN_PW})).status_code == 200
        assert (await c2.post("/api/v1/auth/login", json={"username": "other", "password": ADMIN_PW})).status_code == 401
    await app2.state.pools.close()


async def test_env_admin_means_nothing_to_claim(tmp_path, monkeypatch, scratch_db):
    monkeypatch.setenv("H3MAP_DATA_DIR", str(tmp_path))
    settings = Settings(_env_file=None, jwt_secret="t" * 40, connections_file=None, admin_password="env-admin-password", app_database_url=None, encryption_key=None)
    app = create_app(settings, {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/api/v1/setup/status")).json() == {"needsSetup": False}
        assert (await c.post("/api/v1/setup", json=body(app, scratch_db))).status_code == 409
        assert (await c.post("/api/v1/auth/login", json={"username": "admin", "password": "env-admin-password"})).status_code == 200
    await app.state.pools.close()


def test_bootstrap_persists_and_survives_a_restart(tmp_path, monkeypatch):
    from app import bootstrap
    monkeypatch.setenv("H3MAP_DATA_DIR", str(tmp_path))
    for var in ("H3MAP_APP_DATABASE_URL", "H3MAP_JWT_SECRET", "H3MAP_ENCRYPTION_KEY"):  # the shared fixtures export some
        monkeypatch.delenv(var, raising=False)
    s1 = bootstrap.apply(Settings(_env_file=None))
    bootstrap.save_app_db_url("postgresql://u:p@h/db")
    s2 = bootstrap.apply(Settings(_env_file=None))
    assert s1.jwt_secret.get_secret_value() == s2.jwt_secret.get_secret_value() != "dev-only-change-me-dev-only-change-me"
    assert s2.app_database_url.get_secret_value() == "postgresql://u:p@h/db"
    assert s1.encryption_key.get_secret_value() == s2.encryption_key.get_secret_value()
    monkeypatch.setenv("H3MAP_JWT_SECRET", "from-the-environment-" * 3)  # the environment always wins
    assert bootstrap.apply(Settings(_env_file=None)).jwt_secret.get_secret_value().startswith("from-the-environment")
