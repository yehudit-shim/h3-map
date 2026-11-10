import json
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import h3
import psycopg
import pytest

from scripts.seed.fixtures import parity_points

T = "/api/v1/connections/fixtures/tables/fx"
FIXTURE = Path(__file__).parent / "fixtures" / "h3_parity_10k.json"


def parity():
    return json.loads(FIXTURE.read_text())


@pytest.fixture(params=["sql", "python"])
def engine(request, app, has_h3_ext):
    """Run aggregate tests with h3-pg (when installed) and with the h3-py fallback."""
    if request.param == "sql" and not has_h3_ext:
        pytest.skip("h3 extension not available")
    s = app.state.settings
    old = s.h3_sql
    s.h3_sql = "auto" if request.param == "sql" else "off"
    yield request.param
    s.h3_sql = old


# ---------------------------------------------------------------- parity: h3-py vs SQL vs API vs h3-js

def test_fixture_matches_seed_and_h3py():
    f = parity()
    assert [tuple(p) for p in f["points"]] == parity_points() and len(f["cells"]) == 10_000
    assert f["cells"] == [h3.latlng_to_cell(lat, lon, f["resolution"]) for lon, lat in f["points"]]


@pytest.mark.h3pg
def test_sql_h3pg_matches_fixture(admin_dsn, has_h3_ext):
    if not has_h3_ext:
        pytest.skip("h3 extension not available")
    f = parity()
    with psycopg.connect(admin_dsn) as c:
        rows = c.execute("SELECT id, h3_latlng_to_cell(point(ST_X(geom), ST_Y(geom)), %s)::text FROM fx.parity_pts ORDER BY id",
                         (f["resolution"],)).fetchall()
    assert [r[1] for r in rows] == f["cells"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_h3js_matches_fixture():
    script = Path(__file__).parent / "js" / "verify_h3js.mjs"
    if not (Path(__file__).resolve().parents[2] / "node_modules" / "h3-js").exists():
        pytest.skip("npm install has not been run")
    r = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr


async def test_api_aggregate_matches_fixture_both_engines(client, H, engine):
    f = parity()
    r = await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": f["resolution"], "maxCells": 100000}, headers=H)
    j = r.json()
    assert r.status_code == 200 and j["engine"] == engine and j["resolution"] == f["resolution"] and not j["coarsened"]
    got = {c["h3"]: c["count"] for c in j["cells"]}
    assert got == dict(Counter(f["cells"])) and sum(got.values()) == 10_000
    assert all(c["value"] == c["count"] for c in j["cells"])  # agg=count


# ---------------------------------------------------------------- aggregate semantics

async def test_aggregate_values_and_weights(client, H, engine, admin_dsn):
    f = parity()
    res = 7
    exp = {}
    for i, (lon, lat) in enumerate(f["points"], 1):
        exp.setdefault(h3.latlng_to_cell(lat, lon, res), []).append(float(i % 17))
    for agg, fn in (("sum", sum), ("avg", lambda v: sum(v) / len(v)), ("min", min), ("max", max)):
        j = (await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": res, "agg": agg, "value": "val"}, headers=H)).json()
        got = {c["h3"]: c["value"] for c in j["cells"]}
        assert set(got) == set(exp)
        assert all(abs(got[k] - fn(v)) < 1e-9 for k, v in exp.items()), agg
    j = (await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": res, "agg": "median", "value": "val"}, headers=H)).json()
    import statistics
    assert all(abs(c["value"] - statistics.median(exp[c["h3"]])) < 1e-9 for c in j["cells"])
    jw = (await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": res, "agg": "sum", "value": "val", "weight": "id"}, headers=H)).json()
    expw = {}
    for i, (lon, lat) in enumerate(f["points"], 1):
        expw[h3.latlng_to_cell(lat, lon, res)] = expw.get(h3.latlng_to_cell(lat, lon, res), 0) + (i % 17) * i
    assert all(abs(c["value"] - expw[c["h3"]]) < 1e-6 for c in jw["cells"])


async def test_aggregate_bbox_filter_and_validation(client, H, engine):
    j = (await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": 8, "bbox": "34.5,31.5,34.7,31.7"}, headers=H)).json()
    f = parity()
    n = sum(1 for lon, lat in f["points"] if 34.5 <= lon <= 34.7 and 31.5 <= lat <= 31.7)
    assert sum(c["count"] for c in j["cells"]) == n > 0
    flt = json.dumps({"column": "id", "op": "lte", "value": 100})
    j = (await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": 8, "filter": flt}, headers=H)).json()
    assert sum(c["count"] for c in j["cells"]) == 100
    for params in ({"resolution": 16}, {"resolution": -1}, {"agg": "sum"}, {"agg": "bogus"}, {"value": "geom", "agg": "sum"},
                   {"value": "nope", "agg": "sum"}, {"maxCells": 0}, {"weight": "geom"}):
        r = await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": 8, **params}, headers=H)
        assert r.status_code == 422, (params, r.status_code)
    assert (await client.get(f"{T}/h3_text/h3/aggregate", params={"resolution": 8}, headers=H)).status_code == 422  # no geometry


async def test_max_cells_coarsening_reports_resolution_used(client, H, engine):
    r = await client.get(f"{T}/parity_pts/h3/aggregate", params={"resolution": 10, "maxCells": 500}, headers=H)
    j = r.json()
    assert j["requestedResolution"] == 10 and j["resolution"] < 10 and j["coarsened"] is True
    assert 0 < len(j["cells"]) <= 500 and all(h3.get_resolution(c["h3"]) == j["resolution"] for c in j["cells"])
    assert sum(c["count"] for c in j["cells"]) == 10_000 and j["truncated"] is False


# ---------------------------------------------------------------- /h3/cells on stored H3 tables

@pytest.mark.parametrize("table,col", [("h3_bigint", "h3_index"), ("h3_text", "cell")])
async def test_cells_native_and_rollup(client, H, table, col):
    j = (await client.get(f"{T}/{table}/h3/cells", params={"agg": "sum", "value": "population"}, headers=H)).json()
    assert j["resolution"] == j["nativeResolution"] == 8 and len(j["cells"]) == 1951  # grid_disk(25)
    assert all(h3.is_valid_cell(c["h3"]) and isinstance(c["h3"], str) and h3.get_resolution(c["h3"]) == 8 for c in j["cells"])
    native = {c["h3"]: c["value"] for c in j["cells"]}
    up = (await client.get(f"{T}/{table}/h3/cells", params={"resolution": 6, "agg": "sum", "value": "population"}, headers=H)).json()
    assert up["resolution"] == 6 and not up["coarsened"]
    exp = {}
    for cell, v in native.items():
        p = h3.cell_to_parent(cell, 6)
        exp[p] = exp.get(p, 0) + v
    assert {c["h3"]: c["value"] for c in up["cells"]} == exp
    fine = (await client.get(f"{T}/{table}/h3/cells", params={"resolution": 11}, headers=H)).json()
    assert fine["resolution"] == 8 and fine["requestedResolution"] == 11  # never invents children
    assert up["stats"]["min"] <= up["stats"]["mean"] <= up["stats"]["max"] and set(up["stats"]["quantiles"]) == {"p05", "p25", "p50", "p75", "p95"}


async def test_cells_bbox_and_max_cells(client, H, has_h3_ext):
    lat, lng = h3.cell_to_latlng(h3.latlng_to_cell(32.0, 35.0, 8))
    x0, y0, x1, y1 = lng - 0.05, lat - 0.05, lng + 0.05, lat + 0.05
    allc = (await client.get(f"{T}/h3_text/h3/cells", headers=H)).json()["cells"]
    inside = {c["h3"] for c in allc if x0 <= h3.cell_to_latlng(c["h3"])[1] <= x1 and y0 <= h3.cell_to_latlng(c["h3"])[0] <= y1}
    assert inside
    tables = ["h3_text"] + (["h3_native"] if has_h3_ext else [])
    for t in tables:  # no geometry column: covering index ranges are used
        j = (await client.get(f"{T}/{t}/h3/cells", params={"bbox": f"{x0},{y0},{x1},{y1}"}, headers=H)).json()
        got = {c["h3"] for c in j["cells"]}
        assert inside <= got and len(got) < 1951
    j = (await client.get(f"{T}/h3_bigint/h3/cells", params={"bbox": f"{x0},{y0},{x1},{y1}"}, headers=H)).json()  # via its geometry column
    assert {c["h3"] for c in j["cells"]} == inside
    j = (await client.get(f"{T}/h3_text/h3/cells", params={"maxCells": 100}, headers=H)).json()
    assert j["resolution"] < 8 and j["coarsened"] and len(j["cells"]) <= 100


async def test_cells_mixed_resolution_and_resolutions_endpoint(client, H):
    j = (await client.get(f"{T}/h3_mixed_res/h3/resolutions", headers=H)).json()
    assert {r["resolution"] for r in j["resolutions"]} == {7, 8} and j["storage"] == "bigint"
    assert {r["resolution"]: r["count"] for r in j["resolutions"]}[8] == 300
    c7 = (await client.get(f"{T}/h3_mixed_res/h3/cells", params={"resolution": 7}, headers=H)).json()
    assert c7["resolution"] == 7 and all(h3.get_resolution(c["h3"]) == 7 for c in c7["cells"])
    t = (await client.get(f"{T}/h3_bigint/h3/resolutions", headers=H)).json()
    assert t["resolutions"] == [{"resolution": 8, "count": 1951}]


async def test_cells_validation(client, H):
    for path, params in ((f"{T}/pts_4326/h3/cells", {"column": "name"}), (f"{T}/pts_4326/h3/cells", {}),
                         (f"{T}/h3_text/h3/cells", {"column": "population"}), (f"{T}/h3_text/h3/cells", {"agg": "sum"}),
                         (f"{T}/h3_text/h3/cells", {"resolution": 20}), (f"{T}/h3_text/h3/cells", {"column": "x'; DROP TABLE a;--"})):
        assert (await client.get(path, params=params, headers=H)).status_code == 422, (path, params)


# ---------------------------------------------------------------- stateless endpoints

async def test_cells_info(client, H):
    cell = h3.latlng_to_cell(37.7749, -122.4194, 9)
    pent = next(iter(h3.get_pentagons(5)))
    r = await client.post("/api/v1/h3/cells/info", json={"cells": [cell, pent]}, headers=H)
    a, b = r.json()
    assert cell == "89283082803ffff" == a["h3"] and a["resolution"] == 9 and a["isPentagon"] is False
    assert a["parent"] == h3.cell_to_parent(cell, 8) and len(a["boundary"]) == 7 and a["boundary"][0] == a["boundary"][-1]
    assert abs(a["area_km2"] - h3.cell_area(cell, unit="km^2")) < 1e-12 and abs(a["center"]["lat"] - 37.77) < 0.01
    assert b["isPentagon"] is True and len(b["boundary"]) in (6, 11)  # 5 or 10 vertices (+ closing point)
    assert (await client.post("/api/v1/h3/cells/info", json={"cells": [h3.get_res0_cells()[0]]}, headers=H)).json()[0]["parent"] is None


async def test_cells_info_rejects_bad_cells(client, H):
    for bad in (["zzz"], [617796947035815935], ["89283082803FFFF"], ["8928308280fffff"[:-1]], [None], [], ["89283082803ffff"] * 1001):
        r = await client.post("/api/v1/h3/cells/info", json={"cells": bad}, headers=H)
        assert r.status_code == 422, bad
    assert (await client.post("/api/v1/h3/cells/info", json={"cells": ["89283082803ffff"], "x": 1}, headers=H)).status_code == 422


async def test_children_delta_limit(client, H):
    parent = h3.latlng_to_cell(32, 35, 5)
    for delta, n in ((1, 7), (2, 49), (4, 2401)):
        j = (await client.post("/api/v1/h3/cells/children", json={"cell": parent, "resolution": 5 + delta}, headers=H)).json()
        assert len(j["cells"]) == n and sorted(j["cells"]) == sorted(h3.cell_to_children(parent, 5 + delta))
    for res in (10, 5, 4, 16, 0):
        assert (await client.post("/api/v1/h3/cells/children", json={"cell": parent, "resolution": res}, headers=H)).status_code == 422, res
    pent = next(iter(h3.get_pentagons(5)))
    assert len((await client.post("/api/v1/h3/cells/children", json={"cell": pent, "resolution": 6}, headers=H)).json()["cells"]) == 6


async def test_polyfill_modes_and_caps(client, H):
    poly = {"type": "Polygon", "coordinates": [[[34.9, 31.9], [35.1, 31.9], [35.1, 32.1], [34.9, 32.1], [34.9, 31.9]]]}
    out = {}
    for mode in ("center", "full", "overlap"):
        r = await client.post("/api/v1/h3/polyfill", json={"geometry": poly, "resolution": 8, "mode": mode}, headers=H)
        assert r.status_code == 200, r.text
        out[mode] = set(r.json()["cells"])
    assert out["full"] <= out["center"] <= out["overlap"] and len(out["center"]) > 100
    assert all(h3.is_valid_cell(c) for c in out["overlap"])
    world = {"type": "Polygon", "coordinates": [[[-170, -80], [170, -80], [170, 80], [-170, 80], [-170, -80]]]}
    assert (await client.post("/api/v1/h3/polyfill", json={"geometry": world, "resolution": 9}, headers=H)).status_code == 413
    for body in ({"geometry": {"type": "Point", "coordinates": [0, 0]}, "resolution": 5}, {"geometry": poly, "resolution": 16},
                 {"geometry": poly, "resolution": 5, "mode": "bogus"}, {"geometry": poly, "resolution": 5, "x": 1}):
        assert (await client.post("/api/v1/h3/polyfill", json=body, headers=H)).status_code == 422, body


def test_child_ranges_contain_exactly_the_descendants():
    from app.services.h3_service import child_ranges, parent_expr  # noqa: F401
    parent = h3.latlng_to_cell(32, 35, 5)
    lo, hi = child_ranges(parent, 8)
    kids = [int(c, 16) for c in h3.cell_to_children(parent, 8)]
    assert all(lo <= k <= hi for k in kids) and lo <= min(kids) and max(kids) <= hi
    outsiders = [int(c, 16) for n in h3.grid_ring(parent, 1) for c in h3.cell_to_children(n, 8)]
    assert not any(lo <= o <= hi for o in outsiders)


def test_sql_parent_formula_matches_h3py(admin_dsn):
    cells = [h3.latlng_to_cell(lat, lon, 9) for lon, lat in parity_points(300, seed=5)] + [h3.cell_to_children(next(iter(h3.get_pentagons(4))), 9)[0]]
    with psycopg.connect(admin_dsn) as c:
        for res in (0, 3, 6, 9):
            for cell in cells:
                got = c.execute("SELECT to_hex(((%s::bigint | ((1::bigint << %s) - 1)) & ~(15::bigint << 52)) | (%s::bigint << 52))",
                                (int(cell, 16), 3 * (15 - res), res)).fetchone()[0]
                assert got == h3.cell_to_parent(cell, res)
