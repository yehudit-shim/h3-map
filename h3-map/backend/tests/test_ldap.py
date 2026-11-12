"""LDAP login, run against ldap3's in-memory MOCK_SYNC directory so the real provider code executes without a server
(and without PostgreSQL: the app is built with no connections)."""
from __future__ import annotations

import logging

import httpx
import pytest
import pytest_asyncio
from ldap3 import MOCK_SYNC, Connection, Server
from ldap3.core.exceptions import LDAPSocketOpenError
from pydantic import ValidationError

from app.auth import ldap_auth
from app.config import Settings
from app.main import create_app

BASE = "dc=example,dc=com"
SVC_DN, SVC_PW = f"cn=svc,{BASE}", "svc-bind-secret"
ADMIN_PW = "local-admin-pw"
PEOPLE = {"alice": "alice-pw", "bob": "bob-pw", "carol": "carol-pw", "admin": "ldap-admin-pw"}


def _settings(**over) -> Settings:
    base = dict(jwt_secret="test-secret-test-secret-test-secret", admin_password=ADMIN_PW, connections_file=None,
                ldap_enabled=True, ldap_url="ldap://fake", ldap_base_dn=BASE, ldap_bind_dn=SVC_DN,
                ldap_bind_password=SVC_PW, ldap_admin_users=["Bob"], ldap_editor_users=["carol"])
    base.update(over)
    return Settings(**base)


@pytest.fixture
def directory(monkeypatch):
    server = Server("mock-directory")
    seed = Connection(server, user=SVC_DN, password=SVC_PW, client_strategy=MOCK_SYNC)
    seed.strategy.add_entry(SVC_DN, {"userPassword": SVC_PW, "objectClass": "person", "cn": "svc"})
    for uid, pw in PEOPLE.items():
        seed.strategy.add_entry(f"uid={uid},ou=people,{BASE}", {"userPassword": pw, "objectClass": "inetOrgPerson", "uid": uid})
    # a second entry with the same uid so the filter becomes ambiguous for "dup"
    for ou in ("a", "b"):
        seed.strategy.add_entry(f"uid=dup,ou={ou},{BASE}", {"userPassword": "dup-pw", "objectClass": "inetOrgPerson", "uid": "dup"})
    monkeypatch.setattr(ldap_auth, "_CLIENT_STRATEGY", MOCK_SYNC)
    monkeypatch.setattr(ldap_auth, "_server", lambda s: server)
    return server


@pytest_asyncio.fixture
async def client(directory):
    app = create_app(_settings(), {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    await app.state.pools.close()


async def login(client, username, password):
    return await client.post("/api/v1/auth/login", json={"username": username, "password": password})


async def role_of(client, r):
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {r.json()['accessToken']}"})
    return me.json()


async def test_ldap_user_gets_default_role_and_username_subject(client):
    r = await login(client, "alice", "alice-pw")
    assert r.status_code == 200 and r.json()["role"] == "viewer"
    assert await role_of(client, r) == {"user": "alice", "roles": ["viewer"], "settings": {}}


async def test_role_promotion_lists_are_case_insensitive(client):
    assert (await login(client, "Bob", "bob-pw")).json()["role"] == "admin"
    assert (await login(client, "carol", "carol-pw")).json()["role"] == "editor"


async def test_subject_is_lowercased(client):
    r = await login(client, "ALICE", "alice-pw")
    assert r.status_code == 200 and (await role_of(client, r))["user"] == "alice"


@pytest.mark.parametrize("username,password", [
    ("alice", "wrong"), ("nobody", "x"), ("alice", " "), ("dup", "dup-pw"),  # wrong pw, unknown, space pw, ambiguous
])
async def test_bad_credentials_are_401(client, username, password):
    r = await login(client, username, password)
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize("username", ["*", "*)(uid=*", "alice)(|(uid=*", "a*", "\\2a", "alice\x00"])
async def test_filter_injection_cannot_match(client, username):
    r = await login(client, username, "alice-pw")
    assert r.status_code == 401


def test_empty_password_never_reaches_the_directory(directory):
    assert ldap_auth.authenticate(_settings(), "alice", "") is None
    assert ldap_auth.authenticate(_settings(), "", "alice-pw") is None


async def test_directory_down_is_503_and_break_glass_still_works(client, monkeypatch):
    def boom(*a, **k):
        raise LDAPSocketOpenError("connection refused")
    monkeypatch.setattr(ldap_auth, "_connection", boom)
    r = await login(client, "alice", "alice-pw")
    assert r.status_code == 503 and r.json()["error"]["code"] == "auth_unavailable"
    assert (await login(client, "admin", ADMIN_PW)).json()["role"] == "admin"


async def test_wrong_service_account_password_is_503_not_401(directory, monkeypatch):
    app = create_app(_settings(ldap_bind_password="not-the-svc-password"), {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await login(c, "alice", "alice-pw")
    assert r.status_code == 503


async def test_local_admin_is_never_authenticated_by_ldap(client):
    # the directory also has an "admin" with a different password: only the local one counts
    assert (await login(client, "admin", ADMIN_PW)).status_code == 200
    assert (await login(client, "admin", "ldap-admin-pw")).status_code == 401
    assert (await login(client, "ADMIN", "ldap-admin-pw")).status_code == 401


async def test_ldap_disabled_keeps_local_only(directory):
    app = create_app(_settings(ldap_enabled=False), {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        assert (await login(c, "alice", "alice-pw")).status_code == 401
        assert (await login(c, "admin", ADMIN_PW)).status_code == 200
        cfg = await c.get("/api/v1/config", headers={"Authorization": f"Bearer {(await login(c, 'admin', ADMIN_PW)).json()['accessToken']}"})
        assert cfg.json()["featureFlags"]["ldap"] is False


async def test_config_reports_ldap_flag(client):
    tok = (await login(client, "alice", "alice-pw")).json()["accessToken"]
    cfg = await client.get("/api/v1/config", headers={"Authorization": f"Bearer {tok}"})
    assert cfg.json()["featureFlags"]["ldap"] is True


async def test_no_secret_in_logs(client, caplog):
    caplog.set_level(logging.DEBUG)
    await login(client, "alice", "typed-wrong-password-xyz")
    await login(client, "alice", "alice-pw")
    text = caplog.text
    assert "typed-wrong-password-xyz" not in text and "alice-pw" not in text and SVC_PW not in text


def test_settings_validation():
    with pytest.raises(ValidationError):
        Settings(ldap_enabled=True)  # needs url + base dn
    with pytest.raises(ValidationError):
        _settings(ldap_user_filter="(uid=alice)")  # no {username} placeholder
    with pytest.raises(ValidationError):
        _settings(ldap_default_role="root")
    assert Settings(ldap_enabled=False).ldap_enabled is False
