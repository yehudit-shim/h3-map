"""Generate large synthetic datasets on demand (never committed). Deterministic: seeded random().

    python -m scripts.seed.seed_large create            # creates database h3map_perf and the tables below
    python -m scripts.seed.seed_large drop

Needs H3MAP_TEST_ADMIN_DSN (superuser DSN of the local server). Tables (schema perf):
    points_100k, points_1m, points_10m   Point/4326, GiST, PK, analysed
    polys_1m                             Polygon/4326 (~1 km squares), GiST, PK, analysed
    h3_1m                                bigint H3 cells at res 9 + population, PK
"""
from __future__ import annotations

import os
import sys
import time

import psycopg

DB = "h3map_perf"
LON0, LON1, LAT0, LAT1 = 34.2, 35.9, 29.4, 33.4
CHUNK = 1_000_000


def _rows_sql(kind: str) -> str:
    x = f"{LON0} + random() * {LON1 - LON0}"
    y = f"{LAT0} + random() * {LAT1 - LAT0}"
    if kind == "point":
        return f"SELECT i, (ARRAY['a','b','c','d','e'])[1 + (i %% 5)], random() * 1000, ST_SetSRID(ST_MakePoint({x}, {y}), 4326) FROM generate_series(%s, %s) i"
    return (f"SELECT i, (ARRAY['a','b','c','d','e'])[1 + (i %% 5)], random() * 1000, "
            f"ST_SetSRID(ST_MakeEnvelope(x, y, x + 0.004 + random() * 0.006, y + 0.004 + random() * 0.006), 4326) "
            f"FROM (SELECT i, {x} AS x, {y} AS y FROM generate_series(%s, %s) i) g")


def _fill(c: psycopg.Connection, table: str, n: int, kind: str) -> None:
    t0 = time.time()
    c.execute(f"CREATE TABLE perf.{table} (id bigint PRIMARY KEY, cat text, val float8, geom geometry({'Point' if kind == 'point' else 'Polygon'},4326))")
    c.execute("SELECT setseed(0.42)")
    for lo in range(1, n + 1, CHUNK):
        c.execute(f"INSERT INTO perf.{table} {_rows_sql(kind)}", (lo, min(lo + CHUNK - 1, n)))
    c.execute(f"CREATE INDEX {table}_gix ON perf.{table} USING gist (geom)")
    c.execute(f"ANALYZE perf.{table}")
    print(f"  {table}: {n:,} rows in {time.time() - t0:.0f}s", flush=True)


def create(admin_dsn: str) -> None:
    with psycopg.connect(admin_dsn, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {DB}")
    dsn = admin_dsn.rsplit("/", 1)[0] + "/" + DB
    with psycopg.connect(dsn, autocommit=True) as c:
        c.execute("CREATE EXTENSION postgis")
        c.execute("CREATE SCHEMA perf")
        _fill(c, "points_100k", 100_000, "point")
        _fill(c, "points_1m", 1_000_000, "point")
        _fill(c, "polys_1m", 1_000_000, "poly")
        t0 = time.time()
        c.execute("CREATE TABLE perf.h3_1m (h3_index bigint PRIMARY KEY, population int)")
        has_h3 = c.execute("SELECT 1 FROM pg_available_extensions WHERE name='h3'").fetchone()
        if has_h3:
            c.execute("CREATE EXTENSION IF NOT EXISTS h3")
            c.execute("INSERT INTO perf.h3_1m SELECT DISTINCT ON (h) h, (random() * 1000)::int FROM "
                      "(SELECT h3_latlng_to_cell(point(34.2 + random() * 1.7, 29.4 + random() * 4.0), 10)::bigint AS h FROM generate_series(1, 1500000)) s(h)")
        c.execute("ANALYZE perf.h3_1m")
        print(f"  h3_1m: {c.execute('SELECT count(*) FROM perf.h3_1m').fetchone()[0]:,} rows in {time.time() - t0:.0f}s", flush=True)
        _fill(c, "points_10m", 10_000_000, "point")
        c.execute("GRANT USAGE ON SCHEMA perf TO PUBLIC")
        c.execute("GRANT SELECT ON ALL TABLES IN SCHEMA perf TO PUBLIC")


def drop(admin_dsn: str) -> None:
    with psycopg.connect(admin_dsn, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")


if __name__ == "__main__":
    dsn = os.environ.get("H3MAP_TEST_ADMIN_DSN")
    if not dsn or len(sys.argv) != 2 or sys.argv[1] not in ("create", "drop"):
        sys.exit(__doc__)
    (create if sys.argv[1] == "create" else drop)(dsn)
