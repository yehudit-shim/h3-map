"""Deterministic fixture database for tests and local development.

    python -m scripts.seed.fixtures postgresql://user:pw@host:5432/db

Everything is generated from fixed seeds, so two runs produce identical rows.
Roles created: h3map_test_reader (SELECT on fx), h3map_test_limited (one table only).
"""
from __future__ import annotations

import random
import sys

import h3
import psycopg

LON0, LON1, LAT0, LAT1 = 34.5, 35.5, 31.5, 32.5
READER_PW = "reader_pw"
LIMITED_PW = "limited_pw"
PARITY_N = 10_000
PARITY_RES = 9


def parity_points(n: int = PARITY_N, seed: int = 20260101) -> list[tuple[float, float]]:
    """(lon, lat) pairs, rounded to 6 decimals so every language sees identical numbers."""
    rng = random.Random(seed)
    return [(round(rng.uniform(LON0, LON1), 6), round(rng.uniform(LAT0, LAT1), 6)) for _ in range(n)]


def _rows(n: int, seed: int):
    rng = random.Random(seed)
    cats = ["park", "school", "shop", "clinic", "home"]
    for i in range(1, n + 1):
        yield (i, f"name_{i}", rng.randint(0, 10_000), rng.choice(cats),
               round(rng.uniform(LON0, LON1), 6), round(rng.uniform(LAT0, LAT1), 6))


def _copy(conn, table: str, cols: str, rows) -> None:
    with conn.cursor() as cur, cur.copy(f"COPY {table} ({cols}) FROM STDIN") as cp:
        for r in rows:
            cp.write_row(r)


def build(conn: psycopg.Connection, with_h3_ext: bool = False) -> None:
    conn.autocommit = True
    ex = conn.execute
    ex("CREATE EXTENSION IF NOT EXISTS postgis")
    if with_h3_ext:
        ex("CREATE EXTENSION IF NOT EXISTS h3")
    ex("DROP SCHEMA IF EXISTS fx CASCADE")
    ex("DROP SCHEMA IF EXISTS fx_hidden CASCADE")
    ex("CREATE SCHEMA fx")
    ex("CREATE SCHEMA fx_hidden")
    ex("COMMENT ON SCHEMA fx IS 'fixtures'")

    n = 2000
    # staging of raw lon/lat reused by several tables
    ex("CREATE TABLE fx.raw (id int PRIMARY KEY, name text, pop int, cat text, lon float8, lat float8)")
    _copy(conn, "fx.raw", "id,name,pop,cat,lon,lat", _rows(n, 1))

    ex("""CREATE TABLE fx.pts_4326 (id int PRIMARY KEY, name text, pop int, cat text, geom geometry(Point,4326))""")
    ex("COMMENT ON TABLE fx.pts_4326 IS 'points in 4326'")
    ex("INSERT INTO fx.pts_4326 SELECT id,name,pop,cat,ST_SetSRID(ST_MakePoint(lon,lat),4326) FROM fx.raw")
    ex("CREATE INDEX pts_4326_gix ON fx.pts_4326 USING gist (geom)")

    ex("CREATE TABLE fx.lines_3857 (id int PRIMARY KEY, name text, len_m float8, geom geometry(LineString,3857))")
    ex("""INSERT INTO fx.lines_3857 SELECT id, name, 0, ST_Transform(ST_SetSRID(ST_MakeLine(
         ST_MakePoint(lon,lat), ST_MakePoint(lon+0.02, lat+0.01)),4326),3857) FROM fx.raw WHERE id <= 500""")
    ex("UPDATE fx.lines_3857 SET len_m = ST_Length(geom)")
    ex("CREATE INDEX lines_3857_gix ON fx.lines_3857 USING gist (geom)")

    ex("CREATE TABLE fx.polys_2039 (id int PRIMARY KEY, name text, pop int, geom geometry(Polygon,2039))")
    ex("""INSERT INTO fx.polys_2039 SELECT id, name, pop, ST_Transform(ST_SetSRID(ST_MakeEnvelope(lon,lat,lon+0.01,lat+0.01),4326),2039)
         FROM fx.raw WHERE id <= 800""")
    ex("CREATE INDEX polys_2039_gix ON fx.polys_2039 USING gist (geom)")

    ex("CREATE TABLE fx.polys_4326 (id int PRIMARY KEY, name text, pop int, cat text, geom geometry(MultiPolygon,4326))")
    ex("""INSERT INTO fx.polys_4326 SELECT id, name, pop, cat,
         ST_Multi(ST_SetSRID(ST_MakeEnvelope(lon,lat,lon+0.02,lat+0.015),4326)) FROM fx.raw WHERE id <= 1000""")
    ex("CREATE INDEX polys_4326_gix ON fx.polys_4326 USING gist (geom)")

    ex("CREATE TABLE fx.srid0_pts (id int PRIMARY KEY, name text, geom geometry(Point,0))")
    ex("INSERT INTO fx.srid0_pts SELECT id,name,ST_SetSRID(ST_MakePoint(lon,lat),0) FROM fx.raw WHERE id <= 100")
    ex("CREATE INDEX srid0_gix ON fx.srid0_pts USING gist (geom)")

    ex("CREATE TABLE fx.mixed_geom (id int PRIMARY KEY, kind text, geom geometry)")
    ex("""INSERT INTO fx.mixed_geom SELECT id, CASE WHEN id % 2 = 0 THEN 'pt' ELSE 'poly' END,
         CASE WHEN id % 2 = 0 THEN ST_SetSRID(ST_MakePoint(lon,lat),4326)
              ELSE ST_SetSRID(ST_MakeEnvelope(lon,lat,lon+0.01,lat+0.01),4326) END FROM fx.raw WHERE id <= 200""")
    ex("CREATE INDEX mixed_gix ON fx.mixed_geom USING gist (geom)")

    ex("CREATE TABLE fx.geog_pts (id int PRIMARY KEY, name text, geog geography(Point,4326))")
    ex("INSERT INTO fx.geog_pts SELECT id,name,ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography FROM fx.raw WHERE id <= 300")
    ex("CREATE INDEX geog_gix ON fx.geog_pts USING gist (geog)")

    ex("CREATE VIEW fx.v_pts AS SELECT id, name, pop, geom FROM fx.pts_4326 WHERE pop > 5000")
    ex("CREATE MATERIALIZED VIEW fx.mv_pts AS SELECT id, name, cat, geom FROM fx.pts_4326 WHERE cat = 'park'")
    ex("CREATE INDEX mv_pts_gix ON fx.mv_pts USING gist (geom)")

    ex("""CREATE TABLE fx.part_events (id int NOT NULL, kind text, geom geometry(Point,4326), PRIMARY KEY (id))
         PARTITION BY RANGE (id)""")
    ex("CREATE TABLE fx.part_events_a PARTITION OF fx.part_events FOR VALUES FROM (0) TO (500)")
    ex("CREATE TABLE fx.part_events_b PARTITION OF fx.part_events FOR VALUES FROM (500) TO (100000)")
    ex("INSERT INTO fx.part_events SELECT id, cat, ST_SetSRID(ST_MakePoint(lon,lat),4326) FROM fx.raw")
    ex("CREATE INDEX part_events_gix ON fx.part_events USING gist (geom)")

    ex("CREATE TABLE fx.no_index_no_pk (name text, v int, geom geometry(Point,4326))")
    ex("INSERT INTO fx.no_index_no_pk SELECT name, pop, ST_SetSRID(ST_MakePoint(lon,lat),4326) FROM fx.raw WHERE id <= 300")

    ex("CREATE TABLE fx.unanalysed (id int, geom geometry(Point,4326)) WITH (autovacuum_enabled = false)")
    ex("INSERT INTO fx.unanalysed SELECT id, ST_SetSRID(ST_MakePoint(lon,lat),4326) FROM fx.raw WHERE id <= 100")

    ex("""CREATE TABLE fx.stale_stats (id int PRIMARY KEY, geom geometry(Point,4326)) WITH (autovacuum_enabled = false)""")
    ex("INSERT INTO fx.stale_stats SELECT id, ST_SetSRID(ST_MakePoint(lon,lat),4326) FROM fx.raw WHERE id <= 50")
    ex("CREATE INDEX stale_gix ON fx.stale_stats USING gist (geom)")
    ex("ANALYZE fx.stale_stats")
    ex("INSERT INTO fx.stale_stats SELECT id + 100000, ST_SetSRID(ST_MakePoint(lon,lat),4326) FROM fx.raw")

    # point table for aggregation / parity
    ex("CREATE TABLE fx.parity_pts (id int PRIMARY KEY, val float8, geom geometry(Point,4326))")
    pts = parity_points()
    with conn.cursor() as cur, cur.copy("COPY fx.parity_pts (id,val,geom) FROM STDIN") as cp:
        for i, (lon, lat) in enumerate(pts, 1):
            cp.write_row((i, float(i % 17), f"SRID=4326;POINT({lon} {lat})"))
    ex("CREATE INDEX parity_gix ON fx.parity_pts USING gist (geom)")

    # --- H3 tables (three storage forms, near-miss, mixed resolution) -------------------------
    centre = h3.latlng_to_cell((LAT0 + LAT1) / 2, (LON0 + LON1) / 2, 8)
    cells = sorted(h3.grid_disk(centre, 25))
    rng = random.Random(7)
    pops = [rng.randint(1, 1000) for _ in cells]
    ex("CREATE TABLE fx.h3_bigint (h3_index bigint PRIMARY KEY, population int, geom geometry(Point,4326))")
    ex("CREATE TABLE fx.h3_text (cell text PRIMARY KEY, population int)")
    ex("CREATE TABLE fx.h3_near_miss (hexcode text PRIMARY KEY, n int)")
    ex("CREATE TABLE fx.h3_mixed_res (h3_index bigint PRIMARY KEY, population int)")
    for c, p in zip(cells, pops):
        lat, lng = h3.cell_to_latlng(c)
        ex("INSERT INTO fx.h3_bigint VALUES (%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326))", (int(c, 16), p, lng, lat))
        ex("INSERT INTO fx.h3_text VALUES (%s,%s)", (c, p))
    for i in range(200):
        ex("INSERT INTO fx.h3_near_miss VALUES (%s,%s)", (f"{rng.getrandbits(60):015x}", i))
    for c, p in list(zip(cells, pops))[:300]:
        ex("INSERT INTO fx.h3_mixed_res VALUES (%s,%s)", (int(c, 16), p))
        ex("INSERT INTO fx.h3_mixed_res VALUES (%s,%s) ON CONFLICT DO NOTHING", (int(h3.cell_to_parent(c, 7), 16), p))
    ex("CREATE INDEX h3_bigint_gix ON fx.h3_bigint USING gist (geom)")
    if with_h3_ext:
        ex("CREATE TABLE fx.h3_native (h3 h3index PRIMARY KEY, population int)")
        for c, p in zip(cells, pops):
            ex("INSERT INTO fx.h3_native VALUES (%s::h3index,%s)", (c, p))

    # --- hidden schema, roles ---------------------------------------------------------------------
    ex("CREATE TABLE fx_hidden.secret (id int PRIMARY KEY, geom geometry(Point,4326))")
    ex("INSERT INTO fx_hidden.secret VALUES (1, ST_SetSRID(ST_MakePoint(35,32),4326))")
    ex("ANALYZE fx.raw")
    for t in ("pts_4326 lines_3857 polys_2039 polys_4326 srid0_pts mixed_geom geog_pts mv_pts part_events "
              "no_index_no_pk parity_pts h3_bigint h3_text h3_near_miss h3_mixed_res").split():
        ex(f"ANALYZE fx.{t}")
    ex("DROP TABLE fx.raw")

    for role, pw in (("h3map_test_reader", READER_PW), ("h3map_test_limited", LIMITED_PW)):
        ex(f"DROP OWNED BY {role}") if conn.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)).fetchone() else None
        ex(f"DROP ROLE IF EXISTS {role}")
        ex(f"CREATE ROLE {role} LOGIN PASSWORD '{pw}' NOINHERIT")
        ex(f"GRANT CONNECT ON DATABASE {conn.info.dbname} TO {role}")
        ex(f"ALTER ROLE {role} SET default_transaction_read_only = on")
    ex("GRANT USAGE ON SCHEMA public TO h3map_test_reader, h3map_test_limited")  # PostGIS functions / geometry_columns
    ex("GRANT USAGE ON SCHEMA fx TO h3map_test_reader, h3map_test_limited")
    ex("GRANT SELECT ON ALL TABLES IN SCHEMA fx TO h3map_test_reader")
    ex("GRANT USAGE ON SCHEMA fx_hidden TO h3map_test_reader")
    ex("GRANT SELECT ON fx_hidden.secret TO h3map_test_reader")
    ex("GRANT SELECT ON fx.pts_4326 TO h3map_test_limited")


if __name__ == "__main__":  # pragma: no cover
    dsn = sys.argv[1]
    with psycopg.connect(dsn, autocommit=True) as c:
        ext = c.execute("SELECT 1 FROM pg_available_extensions WHERE name='h3'").fetchone() is not None
        build(c, with_h3_ext=ext)
    print("fixtures built")
