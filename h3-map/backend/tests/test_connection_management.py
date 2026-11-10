import io
import logging

import psycopg
import pyarrow as pa

from scripts.seed.fixtures import READER_PW
from tests.conftest import token_for

P = "/api/v1/connections"
TABLE = "/api/v1/connections/fixtures/tables/fx"
NEW_PW = "brand-new-secret-pw"


def body(app_dsn_info, name="My DB", **kw):
    return {"name": name, "host": app_dsn_info["host"], "port": app_dsn_info["port"], "database": app_dsn_info["db"],
            "username": "h3map_test_reader", "password": READER_PW, "sslmode": "disable", **kw}


# ---------------------------------------------------------------- PostGIS helper views hidden

async def test_extension_objects_hidden_from_lists(client, H):
    names = {t["name"] for t in (await client.get("/api/v1/connections/admin/schemas/public/tables", headers=H)).json()}
    assert not ({"geometry_columns", "geography_columns", "spatial_ref_sys", "raster_columns", "raster_overviews"} & names)
    schemas = {s["name"]: s["tableCount"] for s in (await client.get("/api/v1/connections/admin/schemas", headers=H)).json()}
    assert schemas.get("public", 0) == 0  # only extension objects live there in the scratch DB
    assert "pts_4326" in {t["name"] for t in (await client.get("/api/v1/connections/fixtures/schemas/fx/tables", headers=H)).json()}


# ---------------------------------------------------------------- Arrow

async def test_arrow_features(client, H):
    r = await client.get(f"{TABLE}/pts_4326/features", params={"format": "arrow", "limit": 50, "columns": "name,pop", "paginate": "true"}, headers=H)
    assert r.status_code == 200 and r.headers["content-type"] == "application/vnd.apache.arrow.stream"
    t = pa.ipc.open_stream(io.BytesIO(r.content)).read_all()
    assert t.num_rows == 50 and t.column_names == ["name", "pop", "__fid", "__geometry"]
    md = {k.decode(): v.decode() for k, v in t.schema.metadata.items()}
    assert md["truncated"] == "true" and md["nextCursor"] == "50" and md["crs"] == "EPSG:4326"
    from shapely import wkb
    g = wkb.loads(t.column("__geometry")[0].as_py())
    assert g.geom_type == "Point" and 34 < g.x < 36
    j = (await client.get(f"{TABLE}/pts_4326/features", params={"limit": 50, "paginate": "true", "columns": "name,pop"}, headers=H)).json()
    assert [f["properties"]["name"] for f in j["features"]] == t.column("name").to_pylist()
    post = await client.post(f"{TABLE}/polys_4326/features/query", json={"format": "arrow", "limit": 5}, headers=H)
    assert post.status_code == 200 and pa.ipc.open_stream(io.BytesIO(post.content)).read_all().num_rows == 5
    assert (await client.get(f"{TABLE}/pts_4326/features", params={"format": "parquet"}, headers=H)).status_code == 422


# ---------------------------------------------------------------- user connections: CRUD

async def test_user_connection_lifecycle(client, auth, pg_server, admin_dsn, caplog_all):
    info = pg_server
    assert (await client.post(P, json=body(info), headers=auth["editor"])).status_code == 403  # admin only
    r = await client.post(P, json=body(info), headers=auth["admin"])
    assert r.status_code == 201, r.text
    c = r.json()
    cid = c["id"]
    assert c["source"] == "user" and c["name"] == "My DB" and "password" not in c and READER_PW not in r.text
    assert (await client.post(P, json=body(info), headers=auth["admin"])).status_code == 409  # duplicate name
    # the password is stored encrypted, never in plain text
    with psycopg.connect(admin_dsn) as db:
        enc = bytes(db.execute("SELECT password_enc FROM app.connections WHERE id = %s", (cid,)).fetchone()[0])
    assert enc and READER_PW.encode() not in enc
    # it works like any connection
    assert (await client.post(f"{P}/{cid}/test", headers=auth["editor"])).json()["ok"] is True
    tabs = (await client.get(f"{P}/{cid}/schemas/fx/tables", headers=auth["viewer"])).json()
    assert any(t["name"] == "pts_4326" for t in tabs)
    assert any(x["id"] == cid for x in (await client.get(P, headers=auth["viewer"])).json())
    # edit: rename, then break the password -> db_unavailable, then fix it again
    r = await client.patch(f"{P}/{cid}", json={"name": "Renamed"}, headers=auth["admin"])
    assert r.status_code == 200 and r.json()["name"] == "Renamed" and READER_PW not in r.text
    assert (await client.patch(f"{P}/{cid}", json={"password": NEW_PW}, headers=auth["admin"])).status_code == 200
    bad = await client.post(f"{P}/{cid}/test", headers=auth["editor"])
    assert bad.status_code == 502 and NEW_PW not in bad.text
    assert (await client.patch(f"{P}/{cid}", json={"password": READER_PW}, headers=auth["admin"])).status_code == 200
    assert (await client.post(f"{P}/{cid}/test", headers=auth["editor"])).status_code == 200
    # validation
    for patch in ({"port": 0}, {"sslmode": "bogus"}, {"extra": 1}, {"host": "bad host!"}, {"name": ""}):
        assert (await client.patch(f"{P}/{cid}", json=patch, headers=auth["admin"])).status_code == 422, patch
    # nothing secret in logs
    blob = "\n".join(rec.getMessage() + (rec.exc_text or "") for rec in caplog_all.records)
    assert NEW_PW not in blob and READER_PW not in blob
    # delete
    assert (await client.delete(f"{P}/{cid}", headers=auth["editor"])).status_code == 403
    assert (await client.delete(f"{P}/{cid}", headers=auth["admin"])).status_code == 204
    assert (await client.get(f"{P}/{cid}", headers=auth["admin"])).status_code == 404
    assert (await client.delete(f"{P}/{cid}", headers=auth["admin"])).status_code == 404


async def test_env_connections_are_read_only_and_ssrf_guarded(client, auth, pg_server, app):
    assert (await client.patch(f"{P}/fixtures", json={"name": "x"}, headers=auth["admin"])).status_code == 409
    assert (await client.delete(f"{P}/fixtures", headers=auth["admin"])).status_code == 409
    for host in ("169.254.169.254", "0.0.0.0"):
        r = await client.post(P, json=body(pg_server, name=f"ssrf-{host}", host=host), headers=auth["admin"])
        assert r.status_code == 403, host
    assert (await client.post(P, json={**body(pg_server), "password": "x", "bogus": 1}, headers=auth["admin"])).status_code == 422


# ---------------------------------------------------------------- per-user access

async def test_env_connection_allowed_users(client, auth, settings):
    alice = {"Authorization": f"Bearer {token_for(settings, 'viewer', sub='alice')}"}
    path = f"{P}/restricted/schemas"
    assert (await client.get(path, headers=auth["viewer"])).status_code == 403  # sub = viewer-user
    assert (await client.get(path, headers=alice)).status_code == 200
    assert (await client.get(path, headers=auth["admin"])).status_code == 200  # admins always
    assert "restricted" not in {c["id"] for c in (await client.get(P, headers=auth["viewer"])).json()}
    assert "restricted" in {c["id"] for c in (await client.get(P, headers=alice)).json()}
    g = (await client.get(f"{P}/restricted/grants", headers=auth["admin"])).json()
    assert g == {"connectionId": "restricted", "subjects": ["alice"], "restricted": True, "editable": False}
    assert (await client.put(f"{P}/restricted/grants", json={"subjects": []}, headers=auth["admin"])).status_code == 409
    assert (await client.get(f"{P}/restricted/grants", headers=alice)).status_code == 403


async def test_user_connection_grants_and_tiles(client, auth, pg_server, settings):
    r = await client.post(P, json=body(pg_server, name="Grants DB"), headers=auth["admin"])
    cid = r.json()["id"]
    bob = {"Authorization": f"Bearer {token_for(settings, 'viewer', sub='bob')}"}
    carol = {"Authorization": f"Bearer {token_for(settings, 'viewer', sub='carol')}"}
    try:
        assert (await client.get(f"{P}/{cid}/schemas", headers=carol)).status_code == 200  # no grants = open
        g = await client.put(f"{P}/{cid}/grants", json={"subjects": ["bob", "bob", " "]}, headers=auth["admin"])
        assert g.json()["subjects"] == ["bob"] and g.json()["restricted"] is True
        assert (await client.get(f"{P}/{cid}/schemas", headers=bob)).status_code == 200
        assert (await client.get(f"{P}/{cid}/schemas", headers=carol)).status_code == 403
        assert cid not in {c["id"] for c in (await client.get(P, headers=carol)).json()}
        assert (await client.get(f"{P}/{cid}/tables/fx/pts_4326/profile", headers=carol)).status_code == 403
        assert (await client.put(f"{P}/{cid}/grants", json={"subjects": ["x"], "extra": 1}, headers=auth["admin"])).status_code == 422
        # a tile session created while access existed stops working when access is revoked
        s = (await client.post(f"{P}/{cid}/tiles/sessions", json={"schema": "fx", "table": "pts_4326"}, headers=bob)).json()
        url = s["urlTemplate"].format(z=2, x=2, y=1)
        assert (await client.get(url, headers=bob)).status_code in (200, 204)
        await client.put(f"{P}/{cid}/grants", json={"subjects": ["someone-else"]}, headers=auth["admin"])
        assert (await client.get(url, headers=bob)).status_code == 403
        assert (await client.put(f"{P}/{cid}/grants", json={"subjects": []}, headers=auth["admin"])).json()["restricted"] is False
        assert (await client.get(f"{P}/{cid}/schemas", headers=carol)).status_code == 200
    finally:
        await client.delete(f"{P}/{cid}", headers=auth["admin"])


async def test_flags_and_disabled_store(client, H, settings):
    assert (await client.get("/api/v1/config", headers=H)).json()["featureFlags"] == {"arrow": True, "userConnections": True}
    from app.main import create_app
    import httpx
    off = create_app(settings.model_copy(update={"app_database_url": None, "encryption_key": None}), {})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=off), base_url="http://t") as c:
        h = {"Authorization": f"Bearer {token_for(settings, 'admin')}"}
        r = await c.post(P, json={"name": "x", "host": "localhost", "database": "d", "username": "u", "password": "p"}, headers=h)
        assert r.status_code == 501 and r.json()["error"]["code"] == "not_implemented"
