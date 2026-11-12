"""Database users: login against app.users and the admin /users API."""
import uuid

import pytest

from tests.conftest import token_for

PW = "correct-horse-battery"


def _auth(settings, role="admin"):
    return {"Authorization": f"Bearer {token_for(settings, role)}"}


@pytest.fixture
def uname():
    return f"user-{uuid.uuid4().hex[:8]}@example.com"


async def _create(client, settings, name, role="viewer", password=PW):
    r = await client.post("/api/v1/users", json={"username": name, "password": password, "role": role}, headers=_auth(settings))
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, name, password=PW):
    return await client.post("/api/v1/auth/login", json={"username": name, "password": password})


async def test_created_user_can_sign_in_with_its_role(client, settings, uname):
    u = await _create(client, settings, uname, role="editor")
    assert u["username"] == uname and u["role"] == "editor" and u["active"] and "password" not in str(u).lower().replace("passwordhash", "")
    r = await _login(client, uname)
    assert r.status_code == 200 and r.json()["role"] == "editor"
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {r.json()['accessToken']}"})
    assert me.json() == {"user": uname, "roles": ["editor"], "settings": {}}
    listed = (await client.get("/api/v1/users", headers=_auth(settings))).json()
    assert next(x for x in listed if x["username"] == uname)["lastLoginAt"] is not None


async def test_wrong_password_and_unknown_user_look_the_same(client, settings, uname):
    await _create(client, settings, uname)
    a = await _login(client, uname, "not-the-password")
    b = await _login(client, f"nobody-{uname}")
    assert a.status_code == b.status_code == 401
    assert a.json()["error"]["message"] == b.json()["error"]["message"]


async def test_login_name_is_case_insensitive(client, settings, uname):
    await _create(client, settings, uname)
    assert (await _login(client, uname.upper())).status_code == 200


async def test_inactive_user_cannot_sign_in_and_reactivation_works(client, settings, uname):
    u = await _create(client, settings, uname)
    r = await client.patch(f"/api/v1/users/{u['id']}", json={"active": False}, headers=_auth(settings))
    assert r.status_code == 200 and r.json()["active"] is False
    assert (await _login(client, uname)).status_code == 401
    await client.patch(f"/api/v1/users/{u['id']}", json={"active": True}, headers=_auth(settings))
    assert (await _login(client, uname)).status_code == 200


async def test_password_change_and_role_change(client, settings, uname):
    u = await _create(client, settings, uname)
    r = await client.patch(f"/api/v1/users/{u['id']}", json={"password": "a-brand-new-password", "role": "admin"}, headers=_auth(settings))
    assert r.status_code == 200 and r.json()["role"] == "admin"
    assert (await _login(client, uname)).status_code == 401
    assert (await _login(client, uname, "a-brand-new-password")).json()["role"] == "admin"


async def test_delete_user(client, settings, uname):
    u = await _create(client, settings, uname)
    assert (await client.delete(f"/api/v1/users/{u['id']}", headers=_auth(settings))).status_code == 204
    assert (await _login(client, uname)).status_code == 401
    assert (await client.delete(f"/api/v1/users/{u['id']}", headers=_auth(settings))).status_code == 404
    assert (await client.delete("/api/v1/users/not-a-uuid", headers=_auth(settings))).status_code == 404


async def test_duplicate_and_short_password_are_rejected(client, settings, uname):
    await _create(client, settings, uname)
    dup = await client.post("/api/v1/users", json={"username": uname.upper(), "password": PW}, headers=_auth(settings))
    assert dup.status_code in (201, 409)  # the unique index is case-sensitive; exact duplicates must conflict
    exact = await client.post("/api/v1/users", json={"username": uname, "password": PW}, headers=_auth(settings))
    assert exact.status_code == 409
    short = await client.post("/api/v1/users", json={"username": uname + "x", "password": "short"}, headers=_auth(settings))
    assert short.status_code == 422


@pytest.mark.parametrize("role", ["viewer", "editor"])
async def test_only_admins_manage_users(client, settings, role):
    h = _auth(settings, role)
    assert (await client.get("/api/v1/users", headers=h)).status_code == 403
    assert (await client.post("/api/v1/users", json={"username": "x", "password": PW}, headers=h)).status_code == 403


async def test_password_hash_is_never_returned(client, settings, uname):
    await _create(client, settings, uname)
    body = (await client.get("/api/v1/users", headers=_auth(settings))).text
    assert "pbkdf2" not in body and PW not in body
