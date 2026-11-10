import asyncio
import json
import time

import httpx
import psycopg
import pytest
from hypothesis import HealthCheck, given, settings as hsettings, strategies as st
from psycopg import sql

from app.services.discovery import GeomColumn
from app.services.query_builder import Q, bbox_predicate

BASE = "/api/v1/connections/fixtures/tables/fx"


async def feats(client, H, table, **params):
    r = await client.get(f"{BASE}/{table}/features", params=params, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


async def post(client, H, table, body):
    return await client.post(f"{BASE}/{table}/features/query", json=body, headers=H)


async def test_all_points_geojson(client, H):
    j = await feats(client, H, "pts_4326")
    assert j["type"] == "FeatureCollection" and len(j["features"]) == 2000 and j["truncated"] is False
    f = j["features"][0]
    assert f["type"] == "Feature" and isinstance(f["id"], int) and f["geometry"]["type"] == "Point"
    assert set(f["properties"]) == {"id", "name", "pop", "cat"}


async def test_columns_limit_truncated_and_pagination(client, H):
    j = await feats(client, H, "pts_4326", columns="name,pop", limit=100)
    assert len(j["features"]) == 100 and j["truncated"] is True and set(j["features"][0]["properties"]) == {"name", "pop"}
    seen, after = [], None
    for _ in range(30):
        p = {"limit": 500, "paginate": "true"}
        if after is not None:
            p["after"] = after
        j = await feats(client, H, "pts_4326", **p)
        seen += [f["id"] for f in j["features"]]
        after = j["page"]["nextCursor"]
        if not j["truncated"]:
            break
    assert seen == sorted(seen) and len(seen) == len(set(seen)) == 2000 and after is None


async def test_filters_match_sql(client, H, admin_dsn):
    flt = {"op": "and", "args": [{"column": "cat", "op": "in", "value": ["park", "shop"]},
                                 {"column": "pop", "op": "between", "value": [1000, 5000]},
                                 {"op": "or", "args": [{"column": "name", "op": "ilike", "value": "%_1%"},
                                                       {"column": "cat", "op": "is_null"}]}]}
    r = await post(client, H, "pts_4326", {"filter": flt, "limit": 5000})
    got = sorted(f["id"] for f in r.json()["features"])
    with psycopg.connect(admin_dsn) as c:
        exp = sorted(x[0] for x in c.execute(
            "SELECT id FROM fx.pts_4326 WHERE cat IN ('park','shop') AND pop BETWEEN 1000 AND 5000 "
            "AND (name ILIKE '%_1%' OR cat IS NULL)"))
    assert got == exp and got
    r = await post(client, H, "pts_4326", {"filter": {"column": "id", "op": "not_in", "value": [1, 2]}, "limit": 5000})
    assert len(r.json()["features"]) == 1998
    r = await post(client, H, "pts_4326", {"filter": {"op": "not", "args": [{"column": "pop", "op": "gte", "value": 1}]}})
    assert r.status_code == 200
    r = await post(client, H, "pts_4326", {"filter": {"column": "pop", "op": "neq", "value": 5}, "limit": 5000})
    assert r.status_code == 200


async def test_spatial_filters(client, H, admin_dsn):
    poly = {"type": "Polygon", "coordinates": [[[34.6, 31.6], [34.9, 31.6], [34.9, 31.9], [34.6, 31.9], [34.6, 31.6]]]}
    r = await post(client, H, "pts_4326", {"spatial": {"op": "intersects", "geometry": poly}, "limit": 5000})
    got = sorted(f["id"] for f in r.json()["features"])
    with psycopg.connect(admin_dsn) as c:
        exp = sorted(x[0] for x in c.execute(
            "SELECT id FROM fx.pts_4326 WHERE ST_Intersects(geom, ST_MakeEnvelope(34.6,31.6,34.9,31.9,4326))"))
    assert got == exp and got
    near = {"op": "within_distance", "point": [35.0, 32.0], "distance": 20000}
    for t in ("pts_4326", "geog_pts", "lines_3857"):
        r = await post(client, H, t, {"filter": near, "limit": 5000})
        assert r.status_code == 200, (t, r.text)
    with psycopg.connect(admin_dsn) as c:
        exp = sorted(x[0] for x in c.execute(
            "SELECT id FROM fx.pts_4326 WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(35,32),4326)::geography, 20000)"))
    r = await post(client, H, "pts_4326", {"filter": near, "limit": 5000})
    assert sorted(f["id"] for f in r.json()["features"]) == exp
    bad = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}
    assert (await post(client, H, "pts_4326", {"spatial": {"op": "intersects", "geometry": bad}})).status_code == 422
    huge = {"type": "Polygon", "coordinates": [[[i / 1e4, (i % 7) / 1e4] for i in range(12000)] + [[0, 0]]]}
    assert (await post(client, H, "pts_4326", {"spatial": {"op": "intersects", "geometry": huge}})).status_code in (413, 422)


async def test_antimeridian_and_bbox_validation(client, H):
    j = await feats(client, H, "pts_4326", bbox="170,-10,-170,10")
    assert j["features"] == []
    for bad in ("1,2,3", "a,b,c,d", "0,0,200,10", "0,50,10,40", "nan,0,1,1"):
        r = await client.get(f"{BASE}/pts_4326/features", params={"bbox": bad}, headers=H)
        assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request", bad


async def test_projected_tables_and_geography(client, H):
    for t, gtype in (("lines_3857", "LineString"), ("polys_2039", "Polygon"), ("geog_pts", "Point"),
                     ("mv_pts", "Point"), ("v_pts", "Point"), ("part_events", "Point")):
        j = await feats(client, H, t, bbox="34.5,31.5,35.5,32.5")
        assert j["features"], t
        for f in j["features"][:20]:
            assert f["geometry"]["type"] == gtype
            assert "34." in json.dumps(f["geometry"]["coordinates"]) or "35." in json.dumps(f["geometry"]["coordinates"])


async def test_srid0_needs_assumed_srid(client, H):
    assert (await client.get(f"{BASE}/srid0_pts/features", headers=H)).status_code == 422
    j = await feats(client, H, "srid0_pts", assumedSrid=4326, bbox="34.5,31.5,35.5,32.5")
    assert len(j["features"]) == 100


async def test_simplify_by_zoom_on_output(client, H):
    full = await feats(client, H, "polys_4326", limit=50)
    simp = await feats(client, H, "polys_4326", limit=50, simplify="auto", zoom=2)
    assert len(full["features"]) == len(simp["features"]) == 50
    assert (await client.get(f"{BASE}/polys_4326/features", params={"simplify": "x"}, headers=H)).status_code == 400
    assert (await client.get(f"{BASE}/polys_4326/features", params={"zoom": 99}, headers=H)).status_code == 422


async def test_feature_by_id(client, H):
    r = await client.get(f"{BASE}/pts_4326/features/17", headers=H)
    assert r.status_code == 200
    f = r.json()
    assert f["id"] == 17 and f["properties"]["name"] == "name_17"
    assert (await client.get(f"{BASE}/pts_4326/features/99999", headers=H)).status_code == 404
    assert (await client.get(f"{BASE}/no_index_no_pk/features/1", headers=H)).status_code == 422


async def test_bbox_required_for_large_tables(client, H, app):
    s = app.state.settings
    old = s.max_features_no_bbox
    s.max_features_no_bbox = 1000
    try:
        r = await client.get(f"{BASE}/pts_4326/features", headers=H)
        assert r.status_code == 400 and r.json()["error"]["details"]["param"] == "bbox"
        ok = await client.get(f"{BASE}/pts_4326/features", params={"bbox": "34.5,31.5,34.6,31.6"}, headers=H)
        assert ok.status_code == 200
    finally:
        s.max_features_no_bbox = old


async def test_limit_cap(client, H):
    r = await client.get(f"{BASE}/pts_4326/features", params={"limit": 100001}, headers=H)
    assert r.status_code in (400, 422)


# ---------------------------------------------------------------- injection

INJECTIONS = ["'; DROP TABLE fx.pts_4326; --", "\" OR 1=1 --", "x' OR '1'='1", "$$; select pg_sleep(10); $$",
              "pop\"; select 1; --", "ｐｏｐ", "pts_4326\" --", "1; DELETE FROM fx.pts_4326", "%' OR 1=1 --",
              "'", "\"", "name--", "/*", "a b", "fx.pts_4326.pop", "pg_catalog.pg_class"]


@pytest.mark.parametrize("payload", INJECTIONS)
async def test_injection_in_identifiers_and_values(client, H, admin_dsn, payload):
    reqs = [
        client.get(f"{BASE}/{payload}/features", headers=H),
        client.get(f"/api/v1/connections/fixtures/tables/{payload}/pts_4326/features", headers=H),
        client.get(f"{BASE}/pts_4326/features", params={"columns": payload}, headers=H),
        client.get(f"{BASE}/pts_4326/features", params={"geometryColumn": payload}, headers=H),
        client.get(f"{BASE}/pts_4326/features/{payload}", headers=H),
        client.get(f"{BASE}/pts_4326/features", params={"after": payload, "paginate": "true"}, headers=H),
        client.get(f"{BASE}/{payload}/profile", headers=H),
        post(client, H, "pts_4326", {"filter": {"column": payload, "op": "eq", "value": 1}}),
        post(client, H, "pts_4326", {"filter": {"column": "name", "op": "eq", "value": payload}}),
        post(client, H, "pts_4326", {"filter": {"column": "name", "op": "ilike", "value": payload}}),
        post(client, H, "pts_4326", {"filter": {"column": "name", "op": "in", "value": [payload, "a"]}}),
        post(client, H, "pts_4326", {"filter": {"column": "pop", "op": "eq", "value": payload}}),
        post(client, H, "pts_4326", {"filter": {"column": "name", "op": payload, "value": 1}}),
        post(client, H, "pts_4326", {"filter": {"column": "name", "op": "eq", "value": 1, payload: 1}}),
        post(client, H, "pts_4326", {"columns": [payload]}),
    ]
    for r in await asyncio.gather(*reqs):
        assert r.status_code in (200, 400, 404, 422), (payload, r.status_code, r.text[:200])
        low = r.text.lower()
        for leak in ("syntax error", "psycopg", "traceback", "127.0.0.1", "postgresql"):
            assert leak not in low, (payload, leak, r.text[:200])
    with psycopg.connect(admin_dsn) as c:
        assert c.execute("SELECT count(*) FROM fx.pts_4326").fetchone()[0] == 2000


async def test_filter_grammar_limits(client, H):
    deep = {"column": "pop", "op": "gt", "value": 1}
    for _ in range(10):
        deep = {"op": "not", "args": [deep]}
    assert (await post(client, H, "pts_4326", {"filter": deep})).status_code == 422
    wide = {"op": "or", "args": [{"column": "pop", "op": "eq", "value": i} for i in range(60)]}
    r = await post(client, H, "pts_4326", {"filter": wide})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_filter"
    for bad in ({"column": "geom", "op": "eq", "value": "x"}, {"column": "pop", "op": "between", "value": [1]},
                {"column": "pop", "op": "in", "value": []}, {"column": "pop", "op": "eq", "value": [1]},
                {"op": "and", "args": []}, {"op": "bbox", "bbox": [1, 2, 3]},
                {"column": "pop", "op": "eq", "value": True}, {"column": "pop", "op": "eq", "value": 1, "extra": 1}):
        r = await post(client, H, "pts_4326", {"filter": bad})
        assert r.status_code == 422, (bad, r.status_code, r.text)
    r = await post(client, H, "pts_4326", {"bogus": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = await client.get(f"{BASE}/pts_4326/features", params={"filter": "{not json"}, headers=H)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_filter"


async def test_like_patterns_are_bound_not_interpolated(client, H):
    r = await post(client, H, "pts_4326", {"filter": {"column": "name", "op": "like", "value": "name_1%"}, "limit": 5000})
    assert 100 < len(r.json()["features"]) < 2000


# ---------------------------------------------------------------- index use

def _explain(admin_dsn, table, g, bbox):
    q = Q()
    pred = bbox_predicate(q, g, bbox)
    with psycopg.connect(admin_dsn, autocommit=True) as c:
        c.execute("SET enable_seqscan = off")
        stmt = sql.SQL("EXPLAIN SELECT 1 FROM fx.{} WHERE {}").format(sql.Identifier(table), pred)
        return "\n".join(r[0] for r in c.execute(stmt, q.params))


@pytest.mark.parametrize("table,col,gtype,srid,storage,gix", [
    ("pts_4326", "geom", "Point", 4326, "geometry", "pts_4326_gix"),
    ("lines_3857", "geom", "LineString", 3857, "geometry", "lines_3857_gix"),
    ("polys_2039", "geom", "Polygon", 2039, "geometry", "polys_2039_gix"),
    ("geog_pts", "geog", "Point", 4326, "geography", "geog_gix")])
def test_bbox_uses_gist_index_on_the_column(admin_dsn, table, col, gtype, srid, storage, gix):
    plan = _explain(admin_dsn, table, GeomColumn(col, gtype, srid, 2, storage), (34.6, 31.6, 34.7, 31.7))
    assert gix in plan and ("Index Scan" in plan or "Bitmap" in plan), plan


# ---------------------------------------------------------------- property-based vs brute force

BBOX = st.tuples(st.floats(34.3, 35.7), st.floats(31.3, 32.7), st.floats(0.0005, 0.6), st.floats(0.0005, 0.6)).map(
    lambda t: (round(t[0], 5), round(t[1], 5), round(t[0] + t[2], 5), round(t[1] + t[3], 5)))


@pytest.mark.parametrize("table,geomcol", [("pts_4326", "geom"), ("polys_4326", "geom"), ("mixed_geom", "geom"),
                                           ("geog_pts", "geog")])
def test_bbox_equals_bruteforce_st_intersects(live_server, auth, admin_dsn, table, geomcol):
    cast = "::geography" if geomcol == "geog" else ""
    with httpx.Client(base_url=live_server, headers=auth["viewer"], timeout=30) as http, psycopg.connect(admin_dsn) as db:
        @given(BBOX)
        @hsettings(max_examples=40, deadline=None, suppress_health_check=list(HealthCheck))
        def check(bb):
            r = http.get(f"/api/v1/connections/fixtures/tables/fx/{table}/features",
                         params={"bbox": ",".join(map(str, bb)), "limit": 100000})
            assert r.status_code == 200, r.text
            got = sorted(f["id"] for f in r.json()["features"])
            exp = sorted(x[0] for x in db.execute(
                f"SELECT id FROM fx.{table} WHERE ST_Intersects({geomcol}, ST_MakeEnvelope(%s,%s,%s,%s,4326){cast})", bb))
            assert got == exp

        check()


@pytest.mark.parametrize("table", ["lines_3857", "polys_2039"])
def test_projected_bbox_close_to_bruteforce(live_server, auth, admin_dsn, table):
    """Transforming the envelope is an approximation for projected CRSs: allow a 0.002 degree margin either way."""
    q = ("SELECT id FROM fx.%s WHERE ST_Intersects(ST_Transform(geom,4326), ST_MakeEnvelope(%%s,%%s,%%s,%%s,4326))" % table)
    with httpx.Client(base_url=live_server, headers=auth["viewer"], timeout=30) as http, psycopg.connect(admin_dsn) as db:
        @given(BBOX)
        @hsettings(max_examples=25, deadline=None, suppress_health_check=list(HealthCheck))
        def check(bb):
            m = 0.002
            r = http.get(f"/api/v1/connections/fixtures/tables/fx/{table}/features",
                         params={"bbox": ",".join(map(str, bb)), "limit": 100000})
            got = {f["id"] for f in r.json()["features"]}
            inner = set()
            if bb[2] - bb[0] > 2 * m and bb[3] - bb[1] > 2 * m:
                inner = {x[0] for x in db.execute(q, (bb[0] + m, bb[1] + m, bb[2] - m, bb[3] - m))}
            outer = {x[0] for x in db.execute(q, (bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m))}
            assert inner <= got <= outer

        check()


# ---------------------------------------------------------------- writes impossible / cancellation

async def test_writes_impossible_on_every_path(client, auth, admin_dsn, app):
    attempts = [
        ("POST", f"{BASE}/pts_4326/features/query", {"filter": {"column": "name", "op": "eq", "value": "'; UPDATE fx.pts_4326 SET pop=0; --"}}),
        ("POST", f"{BASE}/pts_4326/features/query", {"sql": "DELETE FROM fx.pts_4326"}),
        ("DELETE", f"{BASE}/pts_4326/features/1", None), ("PUT", f"{BASE}/pts_4326/features/1", {"properties": {}}),
        ("PATCH", f"{BASE}/pts_4326", {"pop": 0}), ("POST", "/api/v1/connections", {"name": "x"}),
        ("DELETE", "/api/v1/connections/fixtures", None), ("POST", f"{BASE}/pts_4326/profile", {})]
    for method, path, body in attempts:
        r = await client.request(method, path, json=body, headers=auth["admin"])
        assert r.status_code in (200, 404, 405, 422), (method, path, r.status_code)  # 200 = value was bound, matched nothing
    for cid in ("fixtures", "admin"):  # even a superuser pool is read-only
        async with app.state.pools.connection(cid) as conn:
            for stmt in ("DELETE FROM fx.pts_4326", "UPDATE fx.pts_4326 SET pop = 0", "DROP TABLE fx.pts_4326",
                         "TRUNCATE fx.pts_4326", "INSERT INTO fx.pts_4326 (id) VALUES (999999)"):
                with pytest.raises(psycopg.Error):
                    await conn.execute(stmt)
    with psycopg.connect(admin_dsn) as c:
        assert c.execute("SELECT count(*) FROM fx.pts_4326").fetchone()[0] == 2000


async def test_cancel_on_disconnect(app):
    from app.services.cancel import cancel_on_disconnect

    class Req:
        def __init__(self):
            self.t0 = time.monotonic()

        async def is_disconnected(self):
            return time.monotonic() - self.t0 > 0.5

    async with app.state.pools.connection("fixtures") as conn:
        t0 = time.monotonic()
        async with cancel_on_disconnect(Req(), conn, interval=0.1):
            with pytest.raises(psycopg.errors.QueryCanceled):
                await conn.execute("SELECT pg_sleep(20)")
        assert time.monotonic() - t0 < 5
        assert (await (await conn.execute("SELECT 1 AS x")).fetchone())["x"] == 1


def test_timeout_error_mapping():
    from app.errors import map_db_error
    e = map_db_error(psycopg.errors.QueryCanceled("x"))
    assert e.status == 504 and e.code == "query_timeout"
