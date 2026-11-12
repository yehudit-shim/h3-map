"""Sign in with a PostgreSQL role: PostgreSQL checks the password, group roles decide the app role."""
import uuid

import httpx
import psycopg
import pytest
import pytest_asyncio
from psycopg import sql

from app.main import create_app

PW = "role-pw-123"


def _id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture
def pg(pg_server):
    """Create cluster-wide roles for a test and drop them afterwards."""
    made = []

    def make(name, *, login=True, password=PW, member_of=(), superuser=False):
        with psycopg.connect(pg_server["admin_dsn"], autocommit=True) as c:
            opts = f'{"LOGIN" if login else "NOLOGIN"} {"SUPERUSER" if superuser else ""}'
            c.execute(sql.SQL("CREATE ROLE {} {} PASSWORD {}").format(sql.Identifier(name), sql.SQL(opts), sql.Literal(password)))
            for g in member_of:
                c.execute(sql.SQL("GRANT {} TO {}").format(sql.Identifier(g), sql.Identifier(name)))
        made.append(name)
        return name

    yield make
    with psycopg.connect(pg_server["admin_dsn"], autocommit=True) as c:
        for n in reversed(made):
            c.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(n)))


@pytest_asyncio.fixture
async def groups(settings, pg):
    """An app whose admin / editor group roles are unique to this test."""
    admin_g, editor_g = pg(_id("grp_admin"), login=False), pg(_id("grp_editor"), login=False)
    s = settings.model_copy(update={"pg_admin_role": admin_g, "pg_editor_role": editor_g})
    app = create_app(s, {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c, admin_g, editor_g
    await app.state.pools.close()


async def _login(c, name, password=PW):
    return await c.post("/api/v1/auth/login", json={"username": name, "password": password})


async def test_plain_role_signs_in_as_viewer(groups, pg):
    c, _, _ = groups
    name = pg(_id("bar"))
    r = await _login(c, name)
    assert r.status_code == 200 and r.json()["role"] == "viewer"
    me = await c.get("/api/v1/me", headers={"Authorization": f"Bearer {r.json()['accessToken']}"})
    assert me.json()["user"] == name and me.json()["roles"] == ["viewer"]


async def test_group_membership_decides_the_app_role(groups, pg):
    c, admin_g, editor_g = groups
    assert (await _login(c, pg(_id("ed"), member_of=[editor_g]))).json()["role"] == "editor"
    assert (await _login(c, pg(_id("ad"), member_of=[admin_g]))).json()["role"] == "admin"
    assert (await _login(c, pg(_id("both"), member_of=[editor_g, admin_g]))).json()["role"] == "admin"


async def test_superuser_is_admin(groups, pg):
    c, _, _ = groups
    assert (await _login(c, pg(_id("su"), superuser=True))).json()["role"] == "admin"


async def test_wrong_password_unknown_role_and_nologin_are_all_401(groups, pg):
    c, _, editor_g = groups
    name = pg(_id("bar"))
    responses = [await _login(c, name, "nope"), await _login(c, _id("ghost")), await _login(c, editor_g, PW),
                 await _login(c, name, ""), await _login(c, name + "\u0000", PW)]
    assert {r.status_code for r in responses[:3]} == {401}
    assert responses[3].status_code in (401, 422) and responses[4].status_code == 401
    assert len({r.json()["error"]["message"] for r in responses[:3]}) == 1  # no hint which part was wrong


async def test_group_roles_cannot_be_used_to_sign_in_without_a_password_even_if_names_are_guessed(groups):
    c, admin_g, _ = groups
    assert (await _login(c, admin_g, "")).status_code in (401, 422)
    assert (await _login(c, admin_g, "anything")).status_code == 401


async def test_unreachable_server_is_503_not_401(settings, pg):
    name = pg(_id("bar"))
    from pydantic import SecretStr
    dead = settings.model_copy(update={"app_database_url": SecretStr("postgresql://x:y@127.0.0.1:1/nodb")})
    app = create_app(dead, {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await _login(c, name)
    assert r.status_code == 503 and r.json()["error"]["code"] == "auth_unavailable"
    await app.state.pools.close()


async def test_disabled_flag_turns_it_off(settings, pg):
    name = pg(_id("bar"))
    app = create_app(settings.model_copy(update={"pg_auth_enabled": False}), {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        assert (await _login(c, name)).status_code == 401
    await app.state.pools.close()


async def test_password_is_never_logged_or_returned(groups, pg, caplog):
    c, _, _ = groups
    name = pg(_id("bar"), password="very-secret-pw-42")
    r = await _login(c, name, "very-secret-pw-42")
    assert "very-secret-pw-42" not in r.text and "very-secret-pw-42" not in caplog.text
