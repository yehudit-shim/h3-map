import psycopg
import pytest
from psycopg.rows import dict_row

BASE = "/api/v1/connections/fixtures"


def psql(admin_dsn, sql, params=()):
    with psycopg.connect(admin_dsn, row_factory=dict_row) as c:
        return c.execute(sql, params).fetchall()


async def test_databases(client, H, admin_dsn):
    got = [d["name"] for d in (await client.get(f"{BASE}/databases", headers=H)).json()]
    exp = [r["datname"] for r in psql(admin_dsn, "SELECT datname FROM pg_database WHERE NOT datistemplate AND has_database_privilege('h3map_test_reader', datname,'CONNECT') ORDER BY 1")]
    assert got == exp and "h3map_test" in got


async def test_schemas_match_psql(client, H, admin_dsn):
    got = {s["name"]: s["tableCount"] for s in (await client.get(f"{BASE}/schemas", headers=H)).json()}
    assert "fx" in got and "pg_catalog" not in got and "information_schema" not in got
    exp = psql(admin_dsn, "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                          "WHERE n.nspname='fx' AND c.relkind IN ('r','v','m','p','f') AND has_table_privilege('h3map_test_reader', c.oid,'SELECT')")
    assert got["fx"] == exp[0]["n"]


async def test_tables_match_psql_incl_view_matview_partition(client, H, admin_dsn):
    got = {t["name"]: t for t in (await client.get(f"{BASE}/schemas/fx/tables", headers=H)).json()}
    exp = psql(admin_dsn, "SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                          "WHERE n.nspname='fx' AND c.relkind IN ('r','v','m','p','f') AND has_table_privilege('h3map_test_reader', c.oid,'SELECT')")
    assert set(got) == {r["relname"] for r in exp}
    assert got["v_pts"]["kind"] == "view" and got["mv_pts"]["kind"] == "matview"
    assert got["part_events"]["kind"] == "partitioned" and got["pts_4326"]["kind"] == "table"
    assert got["pts_4326"]["comment"] == "points in 4326"
    assert got["pts_4326"]["geometryColumns"] == [{"name": "geom", "type": "Point", "srid": 4326}]
    assert got["v_pts"]["geometryColumns"][0]["srid"] == 4326 and got["v_pts"]["hasGeometry"]
    assert got["mv_pts"]["geometryColumns"][0]["type"] == "Point"
    assert got["polys_2039"]["geometryColumns"][0] == {"name": "geom", "type": "Polygon", "srid": 2039}
    assert got["lines_3857"]["geometryColumns"][0]["srid"] == 3857
    assert got["srid0_pts"]["geometryColumns"][0]["srid"] == 0
    assert got["geog_pts"]["geometryColumns"][0] == {"name": "geog", "type": "Point", "srid": 4326}
    assert got["h3_bigint"]["hasH3"] and got["h3_text"]["hasH3"] and not got["h3_near_miss"]["hasH3"]
    assert got["pts_4326"]["estimatedRows"] == 2000


async def test_mixed_geometry_column_is_sampled(client, H):
    got = {t["name"]: t for t in (await client.get(f"{BASE}/schemas/fx/tables", headers=H)).json()}
    gc = got["mixed_geom"]["geometryColumns"][0]
    assert gc["type"] == "mixed" and gc["srid"] == 4326


async def test_filters(client, H):
    r = await client.get(f"{BASE}/schemas/fx/tables", params={"kind": "view"}, headers=H)
    assert [t["name"] for t in r.json()] == ["v_pts"]
    r = await client.get(f"{BASE}/schemas/fx/tables", params={"q": "pts", "geo": "true"}, headers=H)
    assert all("pts" in t["name"] and t["hasGeometry"] for t in r.json()) and r.json()
    r = await client.get(f"{BASE}/schemas/fx/tables", params={"q": "100%"}, headers=H)
    assert r.json() == []  # LIKE wildcards are escaped
    assert (await client.get(f"{BASE}/schemas/fx/tables", params={"kind": "bogus"}, headers=H)).status_code == 422


async def test_columns_match_psql(client, H, admin_dsn):
    got = (await client.get(f"{BASE}/tables/fx/pts_4326/columns", headers=H)).json()
    exp = psql(admin_dsn, "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='fx' AND table_name='pts_4326' ORDER BY ordinal_position")
    assert [c["name"] for c in got] == [r["column_name"] for r in exp]
    assert [c["nullable"] for c in got] == [r["is_nullable"] == "YES" for r in exp]
    assert {c["name"]: c["isPrimaryKey"] for c in got}["id"] is True and got[-1]["type"].startswith("geometry(Point,4326)")
    v = (await client.get(f"{BASE}/tables/fx/v_pts/columns", headers=H)).json()
    assert [c["name"] for c in v] == ["id", "name", "pop", "geom"]


async def test_unknown_and_malicious_identifiers_404(client, H):
    for path in ("/tables/fx/nope/columns", "/tables/nope/pts_4326/columns", '/tables/fx/pts_4326"; DROP TABLE x;--/columns'):
        r = await client.get(BASE + path, headers=H)
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


async def test_privileges_respected(client, H):
    lim = "/api/v1/connections/limited"
    names = {s["name"] for s in (await client.get(f"{lim}/schemas", headers=H)).json()}
    assert "fx_hidden" not in names
    t = (await client.get(f"{lim}/schemas/fx/tables", headers=H)).json()
    assert [x["name"] for x in t] == ["pts_4326"]
    assert (await client.get(f"{lim}/tables/fx/lines_3857/columns", headers=H)).status_code == 404
    assert (await client.get(f"{lim}/schemas/fx_hidden/tables", headers=H)).json() == []
    # the reader can see the second schema
    assert "fx_hidden" in {s["name"] for s in (await client.get(f"{BASE}/schemas", headers=H)).json()}
