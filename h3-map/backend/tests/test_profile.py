import pytest

BASE = "/api/v1/connections/fixtures/tables/fx"


async def prof(client, H, t, **params):
    r = await client.get(f"{BASE}/{t}/profile", params=params, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def codes(p):
    return {w["code"] for w in p["warnings"]}


async def test_points_profile(client, H):
    p = await prof(client, H, "pts_4326")
    assert (p["schema"], p["table"], p["kind"]) == ("fx", "pts_4326", "table")
    assert p["estimatedRows"] == 2000 and p["primaryKey"] == ["id"]
    assert p["geometry"][0]["srid"] == 4326 and p["geometry"][0]["type"] == "Point"
    assert any(i["spatial"] and i["method"] == "gist" for i in p["indexes"])
    assert p["recommendedStrategy"] == "json" or p["recommendedStrategy"] == "bbox"
    assert p["estimatedRows"] <= 10_000 and p["recommendedStrategy"] == "json"
    x0, y0, x1, y1 = p["extent"]["bbox"]
    assert 34.4 < x0 < 34.6 and 35.4 < x1 < 35.6 and 31.4 < y0 < 31.6 and 32.4 < y1 < 32.6
    assert p["warnings"] == [] and p["exactRows"] is None
    assert (await prof(client, H, "pts_4326", exact="true"))["exactRows"] == 2000


async def test_projected_extent_is_reprojected_to_4326(client, H):
    for t in ("lines_3857", "polys_2039"):
        p = await prof(client, H, t)
        x0, y0, x1, y1 = p["extent"]["bbox"]
        assert 34.3 < x0 < x1 < 35.7 and 31.3 < y0 < y1 < 32.7, (t, p["extent"])


async def test_srid0(client, H):
    p = await prof(client, H, "srid0_pts")
    assert p["geometry"][0]["srid"] == 0 and p["extent"] is None and "unknown_srid" in codes(p)
    p = await prof(client, H, "srid0_pts", assumedSrid=4326)
    assert p["extent"]["bbox"][0] > 34


async def test_mixed_geometry(client, H):
    p = await prof(client, H, "mixed_geom")
    assert p["geometry"][0]["type"] == "mixed" and "mixed_geometry_types" in codes(p)


async def test_no_index_no_pk_with_suggestion(client, H):
    p = await prof(client, H, "no_index_no_pk")
    assert {"no_spatial_index", "no_primary_key"} <= codes(p)
    sug = next(w for w in p["warnings"] if w["code"] == "no_spatial_index")["suggestion"]
    assert sug == 'CREATE INDEX "no_index_no_pk_geom_gix" ON "fx"."no_index_no_pk" USING gist ("geom");'
    assert p["extent"] is not None  # ST_EstimatedExtent works from stats even without an index


async def test_unanalysed_table(client, H, admin_dsn):
    import psycopg
    with psycopg.connect(admin_dsn) as c:
        assert c.execute("SELECT reltuples FROM pg_class WHERE oid='fx.unanalysed'::regclass").fetchone()[0] == -1
    p = await prof(client, H, "unanalysed")
    assert p["estimatedRows"] == 100 and "never_analysed" in codes(p)  # bounded count, not -1
    assert p["extent"]["estimated"] is False and p["primaryKey"] == []


async def test_stale_stats(client, H):
    import asyncio
    for _ in range(10):  # statistics counters are flushed asynchronously
        p = await prof(client, H, "stale_stats")
        if "stale_statistics" in codes(p):
            break
        await asyncio.sleep(1)
    assert "stale_statistics" in codes(p)


async def test_view_matview_partitioned_geography(client, H):
    v = await prof(client, H, "v_pts")
    assert v["kind"] == "view" and v["geometry"][0]["srid"] == 4326 and v["estimatedRows"] is not None
    assert v["indexes"] == [] and "no_spatial_index" not in codes(v)
    m = await prof(client, H, "mv_pts")
    assert m["kind"] == "matview" and any(i["spatial"] for i in m["indexes"]) and m["extent"]
    pe = await prof(client, H, "part_events")
    assert pe["kind"] == "partitioned" and pe["primaryKey"] == ["id"] and pe["estimatedRows"] >= 0
    g = await prof(client, H, "geog_pts")
    assert g["geometry"][0]["storage"] == "geography" and g["extent"]["bbox"][0] > 34


async def test_h3_detection(client, H, has_h3_ext):
    b = await prof(client, H, "h3_bigint")
    assert b["h3"][0]["column"] == "h3_index" and b["h3"][0]["storage"] == "bigint"
    assert b["h3"][0]["resolutions"] == [8] and b["h3"][0]["confidence"] == 1.0
    t = await prof(client, H, "h3_text")
    assert t["h3"][0]["storage"] == "text" and t["recommendedStrategy"] == "aggregate"
    m = await prof(client, H, "h3_mixed_res")
    assert m["h3"][0]["resolutions"] == [7, 8]
    assert (await prof(client, H, "h3_near_miss"))["h3"] == []
    assert (await prof(client, H, "pts_4326"))["h3"] == []
    if has_h3_ext:
        n = await prof(client, H, "h3_native")
        assert n["h3"][0]["storage"] == "h3index"


async def test_strategy_thresholds(settings):
    from app.services.discovery import GeomColumn
    from app.services.profile import recommend_strategy
    poly, pt = GeomColumn("g", "Polygon", 4326, 2), GeomColumn("g", "Point", 4326, 2)
    assert [recommend_strategy(settings, n, poly, []) for n in (5_000, 50_000, 500_000, 50_000_000)] == ["json", "bbox", "mvt", "mvt"]
    assert recommend_strategy(settings, 50_000_000, pt, []) == "aggregate"
    assert recommend_strategy(settings, 10, None, []) is None


async def test_profile_errors(client, H):
    assert (await client.get(f"{BASE}/nope/profile", headers=H)).status_code == 404
    assert (await client.get("/api/v1/connections/limited/tables/fx/lines_3857/profile", headers=H)).status_code == 404
