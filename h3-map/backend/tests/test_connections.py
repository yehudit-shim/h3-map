import logging

import psycopg
import pytest

from app.config import Settings
from app.services.connections import ConnectionDef, check_host, load_connection_defs
from app.errors import ApiError
from scripts.seed.fixtures import READER_PW, LIMITED_PW

SECRETS = [READER_PW, LIMITED_PW, "down-pw-123"]


async def test_list_and_get_have_no_password(client, H, pg_server):
    r = await client.get("/api/v1/connections", headers=H)
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()}
    assert {"fixtures", "limited", "down"} <= ids
    for c in r.json():
        assert "password" not in c and c["readOnly"] is True and c["source"] == "env"
    for s in SECRETS + [pg_server["admin_pw"]]:
        assert s not in r.text
    assert (await client.get("/api/v1/connections/nope", headers=H)).status_code == 404


async def test_connection_test_endpoint(client, auth):
    r = await client.post("/api/v1/connections/fixtures/test", headers=auth["editor"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] and body["postgis"] and body["latencyMs"] >= 0 and "PostgreSQL" in body["serverVersion"]
    assert isinstance(body["h3Extension"], bool)


async def test_down_connection_is_502_without_leaks(client, auth, caplog_all):
    r = await client.post("/api/v1/connections/down/test", headers=auth["editor"])
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "db_unavailable"
    text = r.text + "\n".join(rec.getMessage() for rec in caplog_all.records)
    for needle in ("127.0.0.1", "down-pw-123", "nodb", "port 1"):
        assert needle not in r.text, needle
    assert "down-pw-123" not in text


async def test_no_secret_in_any_log(client, auth, caplog_all, pg_server):
    caplog_all.set_level(logging.DEBUG)
    for cid in ("fixtures", "limited", "down"):
        await client.post(f"/api/v1/connections/{cid}/test", headers=auth["editor"])
    await client.get("/api/v1/connections", headers=auth["viewer"])
    blob = "\n".join(rec.getMessage() + (rec.exc_text or "") for rec in caplog_all.records)
    for s in SECRETS + [pg_server["admin_pw"]]:
        assert s not in blob, f"secret leaked into logs: {s[:3]}***"


async def test_session_is_read_only_with_timeouts(app):
    async with app.state.pools.connection("fixtures") as conn:
        row = await (await conn.execute("SHOW default_transaction_read_only")).fetchone()
        assert row["default_transaction_read_only"] == "on"
        row = await (await conn.execute("SHOW statement_timeout")).fetchone()
        assert row["statement_timeout"] == "15s"
        row = await (await conn.execute("SHOW idle_in_transaction_session_timeout")).fetchone()
        assert row["idle_in_transaction_session_timeout"] == "30s"
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            await conn.execute("CREATE TABLE fx.should_fail (a int)")
    async with app.state.pools.connection("admin") as conn:  # even a superuser cannot write via the pool
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            await conn.execute("CREATE TABLE public.should_fail (a int)")


async def test_pool_recovers_after_backends_killed(app, client, auth, admin_dsn):
    assert (await client.post("/api/v1/connections/fixtures/test", headers=auth["editor"])).status_code == 200
    with psycopg.connect(admin_dsn, autocommit=True) as c:
        n = c.execute("SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename='h3map_test_reader' AND pid<>pg_backend_pid()").fetchone()[0]
    assert n >= 1
    r = await client.post("/api/v1/connections/fixtures/test", headers=auth["editor"])
    assert r.status_code == 200, r.text


def test_host_guard():
    s = Settings(allow_private_hosts=False, host_allowlist=["localhost"], jwt_secret="x" * 40)
    for bad in ("169.254.169.254", "0.0.0.0", "224.0.0.1", "10.1.2.3", "192.168.0.5", "127.0.0.2"):
        with pytest.raises(ApiError) as e:
            check_host(bad, s)
        assert e.value.status == 403
    check_host("localhost", s)  # explicitly allowed
    dev = Settings(allow_private_hosts=True, jwt_secret="x" * 40)
    check_host("127.0.0.1", dev)
    with pytest.raises(ApiError):
        check_host("169.254.169.254", dev)  # metadata is never allowed


def test_yaml_connections_read_secret_from_env(tmp_path):
    f = tmp_path / "connections.yaml"
    f.write_text("connections:\n  - id: main\n    name: Main\n    host: db\n    database: gis\n    username: u\n    password_env: DB_PW\n")
    defs = load_connection_defs(Settings(connections_file=str(f), jwt_secret="x" * 40), env={"DB_PW": "pw-from-env"})
    d = defs["main"]
    assert d.password == "pw-from-env" and "pw-from-env" not in repr(d) and "password" not in d.public()
