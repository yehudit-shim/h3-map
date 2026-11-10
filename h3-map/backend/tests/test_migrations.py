import os
from pathlib import Path

import psycopg
from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parents[1]


def _cfg() -> Config:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    return cfg


def _tables(dsn):
    with psycopg.connect(dsn) as c:
        return {r[0] for r in c.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='app'")}


def test_alembic_upgrade_downgrade_cycle(pg_server, monkeypatch, admin_dsn):
    mig_dsn = admin_dsn.rsplit("/", 1)[0] + "/h3map_test_mig"
    with psycopg.connect(admin_dsn, autocommit=True) as c:
        c.execute("DROP DATABASE IF EXISTS h3map_test_mig WITH (FORCE)")
        c.execute("CREATE DATABASE h3map_test_mig")
    try:
        _cycle(monkeypatch, mig_dsn)
    finally:
        with psycopg.connect(admin_dsn, autocommit=True) as c:
            c.execute("DROP DATABASE IF EXISTS h3map_test_mig WITH (FORCE)")


def _cycle(monkeypatch, admin_dsn):
    monkeypatch.setenv("H3MAP_APP_DATABASE_URL", admin_dsn)
    cfg = _cfg()
    command.upgrade(cfg, "head")
    assert {"users", "connections", "connection_grants", "alembic_version"} <= _tables(admin_dsn)
    command.downgrade(cfg, "base")
    assert not ({"users", "connections", "connection_grants"} & _tables(admin_dsn))
    command.upgrade(cfg, "head")  # a second upgrade works after a downgrade
    assert "users" in _tables(admin_dsn)
    command.downgrade(cfg, "base")
