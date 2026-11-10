import math

import psycopg
import pytest

BASE = "/api/v1/connections/fixtures/tables/fx"


async def get(client, H, table, what, **params):
    return await client.get(f"{BASE}/{table}/{what}", params=params, headers=H)


# ---------------------------------------------------------------- rows

async def test_rows_basic_and_geometry_as_wkt(client, H):
    r = await get(client, H, "pts_4326", "rows", limit=5)
    j = r.json()
    assert r.status_code == 200 and [c["name"] for c in j["columns"]] == ["id", "name", "pop", "cat"]
    assert len(j["rows"]) == 5 and j["rows"][0][0] == 1 and j["page"]["hasMore"] is True
    j = (await get(client, H, "pts_4326", "rows", limit=2, includeGeometry="true")).json()
    assert j["columns"][-1] == {"name": "geom", "type": "wkt"} and j["rows"][0][-1].startswith("POINT(")


async def test_rows_keyset_pagination_visits_every_row_once(client, H):
    seen, after = [], None
    for _ in range(50):
        p = {"limit": 300}
        if after is not None:
            p["after"] = after
        j = (await get(client, H, "pts_4326", "rows", **p)).json()
        seen += [r[0] for r in j["rows"]]
        after = j["page"]["nextCursor"]
        if not j["page"]["hasMore"]:
            break
    assert seen == list(range(1, 2001))
    j = (await get(client, H, "pts_4326", "rows", limit=3, sort="-id")).json()
    assert [r[0] for r in j["rows"]] == [2000, 1999, 1998]
    j = (await get(client, H, "pts_4326", "rows", limit=3, sort="-id", after=1998)).json()
    assert [r[0] for r in j["rows"]] == [1997, 1996, 1995]


async def test_rows_offset_sort_columns_filter(client, H, admin_dsn):
    j = (await get(client, H, "pts_4326", "rows", limit=4, offset=10, sort="pop", columns="id,pop")).json()
    with psycopg.connect(admin_dsn) as c:
        exp = c.execute("SELECT id, pop FROM fx.pts_4326 ORDER BY pop ASC NULLS LAST, id LIMIT 4 OFFSET 10").fetchall()
    assert [tuple(r) for r in j["rows"]] == exp
    flt = '{"column":"cat","op":"eq","value":"park"}'
    j = (await get(client, H, "pts_4326", "rows", limit=1000, filter=flt)).json()
    assert j["rows"] and all(r[3] == "park" for r in j["rows"])


async def test_rows_without_pk_and_validation(client, H):
    j = (await get(client, H, "no_index_no_pk", "rows", limit=5)).json()
    assert len(j["rows"]) == 5 and j["page"]["nextCursor"] is None
    assert (await get(client, H, "no_index_no_pk", "rows", after=1)).status_code == 422
    for params in ({"limit": 0}, {"limit": 10001}, {"offset": -1}, {"sort": "geom"}, {"sort": "nope"}, {"columns": "nope"},
                   {"after": 1, "offset": 5}, {"after": "x"}):
        r = await get(client, H, "pts_4326", "rows", **params)
        assert r.status_code in (400, 422), (params, r.status_code)
    assert (await get(client, H, "pts_4326", "rows", limit=2000)).status_code in (200, 422)  # config max 1000 enforced below


async def test_rows_limit_respects_configured_max(client, H):
    r = await get(client, H, "pts_4326", "rows", limit=1001)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


async def test_rows_on_view_and_h3(client, H):
    assert (await get(client, H, "v_pts", "rows", limit=5)).status_code == 200
    j = (await get(client, H, "h3_bigint", "rows", limit=3)).json()
    assert j["columns"][0]["name"] == "h3_index" and isinstance(j["rows"][0][0], int)


# ---------------------------------------------------------------- stats

async def test_numeric_stats_match_sql(client, H, admin_dsn):
    j = (await get(client, H, "pts_4326", "stats", column="pop", bins=10)).json()
    with psycopg.connect(admin_dsn) as c:
        mn, mx, mean, sd, n, qs = c.execute(
            "SELECT min(pop), max(pop), avg(pop)::float8, stddev_samp(pop)::float8, count(distinct pop), "
            "percentile_cont(ARRAY[0.05,0.25,0.5,0.75,0.95]) WITHIN GROUP (ORDER BY pop) FROM fx.pts_4326").fetchone()
    assert (j["min"], j["max"], j["distinct"]) == (mn, mx, n)
    assert math.isclose(j["mean"], mean) and math.isclose(j["stddev"], sd)
    assert [round(v, 6) for v in j["quantiles"].values()] == [round(v, 6) for v in qs] and list(j["quantiles"]) == ["p05", "p25", "p50", "p75", "p95"]
    h = j["histogram"]
    assert len(h) == 10 and sum(b["count"] for b in h) == 2000 and h[0]["from"] == mn and math.isclose(h[-1]["to"], mx)
    assert j["nulls"] == 0 and j["count"] == 2000 and len(j["topValues"]) == 10


async def test_text_stats_and_filter(client, H):
    j = (await get(client, H, "pts_4326", "stats", column="cat")).json()
    assert j["mean"] is None and j["histogram"] is None and j["distinct"] == 5
    assert {v["value"] for v in j["topValues"]} == {"park", "school", "shop", "clinic", "home"}
    assert sum(v["count"] for v in j["topValues"]) == 2000
    flt = '{"column":"cat","op":"eq","value":"park"}'
    jf = (await get(client, H, "pts_4326", "stats", column="pop", filter=flt)).json()
    assert 0 < jf["count"] < 2000 and jf["histogram"]


async def test_stats_validation(client, H):
    for params in ({"column": "geom"}, {"column": "nope"}, {"column": "pop", "bins": 1}, {"column": "pop", "bins": 201}, {}):
        r = await get(client, H, "pts_4326", "stats", **params)
        assert r.status_code in (422,), (params, r.status_code)


# ---------------------------------------------------------------- extent

async def test_extent_unfiltered_and_filtered(client, H, admin_dsn):
    j = (await get(client, H, "pts_4326", "extent")).json()
    assert j["srid"] == 4326 and j["estimated"] is True and 34.4 < j["bbox"][0] < 34.6
    flt = '{"column":"id","op":"lte","value":10}'
    jf = (await get(client, H, "pts_4326", "extent", filter=flt)).json()
    with psycopg.connect(admin_dsn) as c:
        exp = c.execute("SELECT ST_XMin(e),ST_YMin(e),ST_XMax(e),ST_YMax(e) FROM (SELECT ST_Extent(geom) e FROM fx.pts_4326 WHERE id <= 10) x").fetchone()
    assert jf["estimated"] is False and [round(v, 6) for v in jf["bbox"]] == [round(v, 6) for v in exp]
    empty = (await get(client, H, "pts_4326", "extent", filter='{"column":"id","op":"lt","value":0}')).json()
    assert empty["bbox"] is None


async def test_extent_projected_and_srid0(client, H):
    j = (await get(client, H, "polys_2039", "extent", filter='{"column":"id","op":"lte","value":50}')).json()
    assert j["sourceSrid"] == 2039 and 34.3 < j["bbox"][0] < j["bbox"][2] < 35.7
    assert (await get(client, H, "srid0_pts", "extent")).status_code == 400
    ok = await get(client, H, "srid0_pts", "extent", assumedSrid=4326)
    assert ok.status_code == 200 and ok.json()["bbox"][0] > 34
    assert (await get(client, H, "h3_text", "extent")).status_code == 422
