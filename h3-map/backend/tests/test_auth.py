import time

import pytest
from fastapi.routing import APIRoute

from app.auth.jwt import hash_password, verify_hash
from tests.conftest import ADMIN_PW, token_for

PUBLIC = {("GET", "/api/v1/health"), ("POST", "/api/v1/auth/login"), ("GET", "/api/v1/setup/status"),
          ("POST", "/api/v1/setup/test-database"), ("POST", "/api/v1/setup")}


def _dep_calls(dependant):
    for d in dependant.dependencies:
        yield d.call
        yield from _dep_calls(d)


def test_every_route_has_auth_dependency(app):
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.path in ("/api/v1/openapi.json",):
            continue
        if any(( m, route.path) in PUBLIC for m in route.methods):
            continue
        if not any(getattr(c, "__is_auth_dependency__", False) for c in _dep_calls(route.dependant)):
            missing.append((sorted(route.methods), route.path))
    assert not missing, f"routes without an auth dependency: {missing}"


async def test_health_is_public(client):
    r = await client.get("/api/v1/health")
    assert r.status_code == 200


@pytest.mark.parametrize("path", ["/api/v1/me", "/api/v1/config", "/api/v1/connections", "/api/v1/ready"])
async def test_401_without_token(client, path):
    r = await client.get(path)
    assert r.status_code == 401
    err = r.json()["error"]
    assert err["code"] == "unauthenticated" and err["requestId"]


async def test_401_bad_and_expired_token(client, settings):
    assert (await client.get("/api/v1/me", headers={"Authorization": "Bearer nonsense"})).status_code == 401
    expired = token_for(settings, "admin", ttl_s=-10)
    assert (await client.get("/api/v1/me", headers={"Authorization": f"Bearer {expired}"})).status_code == 401
    assert (await client.get("/api/v1/me", headers={"Authorization": "Basic abc"})).status_code == 401


async def test_token_signed_with_other_secret_rejected(client, settings):
    import jwt
    bad = jwt.encode({"sub": "x", "role": "admin", "exp": int(time.time()) + 100}, "other" * 10, algorithm="HS256")
    assert (await client.get("/api/v1/me", headers={"Authorization": f"Bearer {bad}"})).status_code == 401


async def test_login(client):
    r = await client.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PW})
    assert r.status_code == 200
    tok = r.json()["accessToken"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.json()["roles"] == ["admin"]
    bad = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong"})
    assert bad.status_code == 401
    extra = await client.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PW, "x": 1})
    assert extra.status_code == 422 and extra.json()["error"]["code"] == "validation_error"


# role matrix: (method, path, minimum role)
MATRIX = [("GET", "/api/v1/me", "viewer"), ("GET", "/api/v1/connections", "viewer"),
          ("POST", "/api/v1/connections/fixtures/test", "editor")]


@pytest.mark.parametrize("method,path,minimum", MATRIX)
async def test_role_matrix(client, auth, method, path, minimum):
    order = ["viewer", "editor", "admin"]
    for role in order:
        r = await client.request(method, path, headers=auth[role])
        if order.index(role) < order.index(minimum):
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
        else:
            assert r.status_code == 200, r.text


def test_password_hash_roundtrip():
    h = hash_password("pw", iterations=1000)
    assert verify_hash("pw", h) and not verify_hash("pw2", h) and not verify_hash("pw", "garbage")
