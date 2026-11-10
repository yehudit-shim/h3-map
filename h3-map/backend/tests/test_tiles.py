import asyncio
import math

import mapbox_vector_tile
import psycopg
import pytest
from shapely.geometry import shape

from tests.conftest import token_for

C = "/api/v1/connections/fixtures"


def tile_of(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


async def session(client, H, table, **body):
    r = await client.post(f"{C}/tiles/sessions", json={"schema": "fx", "table": table, **body}, headers=H)
    assert r.status_code == 201, r.text
    return r.json()


async def fetch(client, H, s, z, x, y, **kw):
    return await client.get(s["urlTemplate"].format(z=z, x=x, y=y), headers={**H, **kw.get("headers", {})})


def decode(content):
    return mapbox_vector_tile.decode(content)["layer"]["features"]


async def test_session_shape_and_tilejson(client, H):
    s = await session(client, H, "pts_4326", columns=["name", "pop"])
    assert s["urlTemplate"] == f"/api/v1/tiles/{s['sessionId']}/{{z}}/{{x}}/{{y}}.mvt" and len(s["sessionId"]) >= 30
    assert s["fields"] == {"name": "String", "pop": "Number"} and 34 < s["bounds"][0] < 35 and (s["minzoom"], s["maxzoom"]) == (0, 22)
    tj = (await client.get(f"/api/v1/tiles/{s['sessionId']}/tilejson", headers=H)).json()
    assert tj["tilejson"] == "3.0.0" and tj["vector_layers"][0] == {"id": "layer", "fields": s["fields"]}


async def test_points_tile_counts_ids_properties(client, H, admin_dsn):
    s = await session(client, H, "pts_4326", columns=["name", "pop", "cat"])
    x, y = tile_of(35.0, 32.0, 8)
    r = await fetch(client, H, s, 8, x, y)
    assert r.status_code == 200 and r.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert "ETag" in r.headers and "max-age" in r.headers["Cache-Control"]
    feats = decode(r.content)
    with psycopg.connect(admin_dsn) as c:
        exp = c.execute("SELECT count(*) FROM fx.pts_4326 WHERE geom && ST_Transform(ST_TileEnvelope(8,%s,%s,margin=>0.015625),4326)", (x, y)).fetchone()[0]
    assert len(feats) == exp > 0
    for f in feats[:50]:
        assert isinstance(f["id"], int) and 1 <= f["id"] <= 2000 and set(f["properties"]) >= {"name", "pop", "cat"}
        assert f["properties"]["name"] == f"name_{f['id']}" and f["geometry"]["type"] == "Point"


async def test_polygon_tile_geometry_valid_and_in_extent(client, H):
    s = await session(client, H, "polys_4326")
    x, y = tile_of(35.0, 32.0, 10)
    r = await fetch(client, H, s, 10, x, y)
    assert r.status_code == 200
    feats = decode(r.content)
    assert feats
    for f in feats:
        geom = shape(f["geometry"])
        assert f["geometry"]["type"] in ("Polygon", "MultiPolygon") and geom.is_valid and not geom.is_empty
        minx, miny, maxx, maxy = geom.bounds
        assert -64 <= minx and maxx <= 4096 + 64 and -64 <= miny and maxy <= 4096 + 64


@pytest.mark.parametrize("table,z", [("lines_3857", 9), ("polys_2039", 9), ("geog_pts", 8), ("v_pts", 8), ("mv_pts", 8), ("part_events", 8)])
async def test_other_sources_render(client, H, table, z):
    s = await session(client, H, table)
    x, y = tile_of(35.0, 32.0, z)
    found = 0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            r = await fetch(client, H, s, z, x + dx, y + dy)
            assert r.status_code in (200, 204)
            if r.status_code == 200:
                found += len(decode(r.content))
    assert found > 0, table


async def test_empty_tile_is_204_and_zoom_range(client, H):
    s = await session(client, H, "pts_4326", minzoom=5, maxzoom=12)
    assert (await fetch(client, H, s, 8, 0, 0)).status_code == 204
    x, y = tile_of(35, 32, 3)
    assert (await fetch(client, H, s, 3, x, y)).status_code == 204  # below minzoom
    assert (await fetch(client, H, s, 13, *tile_of(35, 32, 13))).status_code == 204  # above maxzoom
    assert (await fetch(client, H, s, 2, 4, 0)).status_code == 404  # out of range for the zoom


async def test_etag_304(client, H):
    s = await session(client, H, "pts_4326")
    x, y = tile_of(35.0, 32.0, 8)
    r = await fetch(client, H, s, 8, x, y)
    r2 = await fetch(client, H, s, 8, x, y, headers={"If-None-Match": r.headers["ETag"]})
    assert r2.status_code == 304 and r2.headers["ETag"] == r.headers["ETag"]
    r3 = await fetch(client, H, s, 8, x, y, headers={"If-None-Match": '"nope"'})
    assert r3.status_code == 200 and r3.content == r.content


async def test_filter_in_session(client, H, admin_dsn):
    s = await session(client, H, "pts_4326", filter={"column": "cat", "op": "eq", "value": "park"}, columns=["cat"])
    x, y = tile_of(35.0, 32.0, 7)
    feats = decode((await fetch(client, H, s, 7, x, y)).content)
    with psycopg.connect(admin_dsn) as c:
        n = c.execute("SELECT count(*) FROM fx.pts_4326 WHERE cat='park' AND geom && ST_Transform(ST_TileEnvelope(7,%s,%s,margin=>0.015625),4326)", (x, y)).fetchone()[0]
    assert len(feats) == n and all(f["properties"]["cat"] == "park" for f in feats)


async def test_feature_cap_and_simplification(client, H, app):
    s = await session(client, H, "pts_4326")
    x, y = tile_of(35.0, 32.0, 6)
    cfg = app.state.settings
    old = cfg.tile_feature_cap
    cfg.tile_feature_cap = 100
    try:
        r = await fetch(client, H, s, 6, x, y)
        assert len(decode(r.content)) == 100 and r.headers["X-Tile-Capped"] == "true"
    finally:
        cfg.tile_feature_cap = old
    p = await session(client, H, "polys_4326")
    lo = await fetch(client, H, p, 3, *tile_of(35, 32, 3))
    hi = await fetch(client, H, p, 12, *tile_of(35.2, 32.1, 12))
    assert lo.status_code in (200, 204) and hi.status_code in (200, 204)


async def test_session_security_and_lifecycle(client, H, auth, settings):
    s = await session(client, H, "pts_4326")
    other = {"Authorization": f"Bearer {token_for(settings, 'viewer', sub='someone-else')}"}
    x, y = tile_of(35, 32, 8)
    assert (await client.get(s["urlTemplate"].format(z=8, x=x, y=y), headers=other)).status_code == 404  # not the owner
    assert (await client.get(s["urlTemplate"].format(z=8, x=x, y=y), headers=auth["admin"])).status_code == 200  # admin may
    assert (await client.get(s["urlTemplate"].format(z=8, x=x, y=y))).status_code == 401  # bearer required
    assert (await client.delete(f"/api/v1/tiles/sessions/{s['sessionId']}", headers=H)).status_code == 204
    assert (await fetch(client, H, s, 8, x, y)).status_code == 404
    assert (await client.delete(f"/api/v1/tiles/sessions/{s['sessionId']}", headers=H)).status_code == 404


async def test_session_validation_and_injection(client, H):
    base = {"schema": "fx", "table": "pts_4326"}
    for body in ({**base, "table": "nope"}, {**base, "table": 'pts_4326"; DROP TABLE x;--'}, {**base, "columns": ["geom"]},
                 {**base, "columns": ["nope"]}, {**base, "geometryColumn": "pop"}, {**base, "minzoom": 9, "maxzoom": 3},
                 {**base, "maxzoom": 25}, {**base, "filter": {"column": "pop", "op": "bogus"}}, {**base, "extra": 1},
                 {"schema": "fx", "table": "no_geometry_here"}, {**base, "table": "h3_text"}):
        r = await client.post(f"{C}/tiles/sessions", json=body, headers=H)
        assert r.status_code in (404, 422), (body, r.status_code, r.text)
    r = await client.post(f"{C}/tiles/sessions", json={"schema": "fx", "table": "srid0_pts"}, headers=H)
    assert r.status_code == 422  # unknown SRID needs assumedSrid
    assert (await client.post(f"{C}/tiles/sessions", json={"schema": "fx", "table": "srid0_pts", "assumedSrid": 4326}, headers=H)).status_code == 201


async def test_concurrent_tiles_do_not_starve_the_pool(client, H):
    s = await session(client, H, "polys_4326")
    x, y = tile_of(35.0, 32.0, 9)
    urls = [s["urlTemplate"].format(z=9, x=x + dx, y=y + dy) for dx in range(-3, 4) for dy in range(-3, 4)] * 2
    rs = await asyncio.gather(*[client.get(u, headers=H) for u in urls[:50]])
    assert len(rs) == 50 and all(r.status_code in (200, 204) for r in rs)
