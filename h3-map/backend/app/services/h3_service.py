"""H3 endpoints (H3_IMPLEMENTATION section 7-8, API_SPECIFICATION section 8).

Indexes leave the server only as 15-character hex strings. Stored forms (h3index / bigint / text) are all handled
through the bigint bit layout of an H3 index (resolution in bits 52-55, one 3-bit digit per resolution below), which
is how a parent is computed in SQL without needing the h3 extension. h3-py is used for everything that is not a bulk
GROUP BY, and for point -> cell binning when the h3 extension is not installed in the database.
"""
from __future__ import annotations

import math
import re
import statistics
from collections import defaultdict
from typing import Any, Iterable

import h3
from psycopg import AsyncConnection, sql

from ..config import Settings
from ..errors import ApiError, validation_error
from .discovery import GeomColumn, TableInfo, pick_geometry
from .filters import compile_filter, validate_geojson
from .query_builder import GEO, NUMERIC, Q, bbox_predicate, col_info, effective_srid, parse_bbox, table_ref

HEX_RE = re.compile(r"^[0-9a-f]{15}$")
AGGS = ("count", "sum", "avg", "min", "max", "median")
RES_SHIFT, RES_MASK = 52, 15
MAX_COVER_RANGES = 2000
MAX_CHILD_DELTA = 4


# --- cell helpers -----------------------------------------------------------------------

def check_cell(cell: Any) -> str:
    if not isinstance(cell, str) or not HEX_RE.match(cell) or not h3.is_valid_cell(cell):
        raise validation_error("Invalid H3 cell. Cells are 15-character lowercase hex strings.", cell=str(cell)[:32])
    return cell


def hex_of_bigint(v: int) -> str:
    return f"{v:x}"


def parent_expr(bigint_col: sql.Composable, res: int) -> sql.Composable:
    """SQL for the ancestor at ``res`` of a cell stored as bigint (valid for rows with resolution >= res)."""
    ones = (1 << (3 * (15 - res))) - 1
    return sql.SQL("((({c} | {ones}::bigint) & ~({m}::bigint)) | {r}::bigint)").format(
        c=bigint_col, ones=sql.Literal(ones), m=sql.Literal(RES_MASK << RES_SHIFT), r=sql.Literal(res << RES_SHIFT))


def resolution_expr(bigint_col: sql.Composable) -> sql.Composable:
    return sql.SQL("(({} >> {}) & {})").format(bigint_col, sql.Literal(RES_SHIFT), sql.Literal(RES_MASK))


def child_ranges(parent: str, row_res: int) -> tuple[int, int]:
    """Inclusive [lo, hi] bigint range holding every descendant of ``parent`` stored at ``row_res``."""
    p_res = h3.get_resolution(parent)
    base = int(parent, 16)
    lo = (base & ~(RES_MASK << RES_SHIFT)) | (row_res << RES_SHIFT)
    hi = lo
    for k in range(p_res + 1, row_res + 1):
        shift = 3 * (15 - k)
        lo &= ~(7 << shift)           # digit 0
        hi = (hi & ~(7 << shift)) | (6 << shift)  # digit 6
    return lo, hi


class H3Column:
    def __init__(self, info: TableInfo, name: str):
        c = col_info(info, name)
        self.name, self.udt = name, c["udt"]
        if self.udt == "h3index":
            self.storage = "h3index"
        elif self.udt == "int8":
            self.storage = "bigint"
        elif self.udt in ("text", "varchar", "bpchar"):
            self.storage = "text"
        else:
            raise validation_error("The column cannot hold H3 indexes (need h3index, bigint or text).", column=name)

    @property
    def ident(self) -> sql.Composable:
        return sql.Identifier(self.name)

    @property
    def as_bigint(self) -> sql.Composable:
        if self.storage == "bigint":
            return self.ident
        if self.storage == "h3index":
            return sql.SQL("({}::bigint)").format(self.ident)
        return sql.SQL("(('x' || lpad({}, 16, '0'))::bit(64)::bigint)").format(self.ident)

    def range_pred(self, ranges: list[tuple[int, int]], q: Q) -> sql.Composable:
        """Index-friendly: JOIN-free ``col BETWEEN lo AND hi`` for any of the ranges (via unnest + EXISTS)."""
        los, his = [r[0] for r in ranges], [r[1] for r in ranges]
        if self.storage == "bigint":
            los_p, his_p = q.add(los), q.add(his)
            return sql.SQL("EXISTS (SELECT 1 FROM unnest({}::bigint[], {}::bigint[]) AS r(lo, hi) WHERE {} BETWEEN r.lo AND r.hi)").format(
                los_p, his_p, self.ident)
        if self.storage == "h3index":
            los_p, his_p = q.add(los), q.add(his)
            return sql.SQL("EXISTS (SELECT 1 FROM unnest({}::bigint[], {}::bigint[]) AS r(lo, hi) WHERE {} BETWEEN r.lo::h3index AND r.hi::h3index)").format(
                los_p, his_p, self.ident)
        los_p, his_p = q.add([hex_of_bigint(v) for v in los]), q.add([hex_of_bigint(v) for v in his])
        return sql.SQL("EXISTS (SELECT 1 FROM unnest({}::text[], {}::text[]) AS r(lo, hi) WHERE {} BETWEEN r.lo AND r.hi)").format(
            los_p, his_p, self.ident)


def default_h3_column(info: TableInfo, name: str | None) -> H3Column:
    if name:
        return H3Column(info, name)
    for c in info.columns:
        if c["udt"] == "h3index":
            return H3Column(info, c["name"])
    from .discovery import H3_NAME_RE
    for c in info.columns:
        if c["udt"] in ("int8", "text", "varchar") and H3_NAME_RE.match(c["name"]):
            return H3Column(info, c["name"])
    raise validation_error("No H3 column found; pass 'column'.")


def covering_ranges(bbox: tuple[float, float, float, float], native_res: list[int], max_ranges: int = MAX_COVER_RANGES
                    ) -> tuple[int, list[tuple[int, int]]]:
    """Pick the finest parent resolution whose overlap cover of the bbox has <= max_ranges cells, and turn
    those parents into index ranges for every native resolution present. Antimeridian boxes are split."""
    x0, y0, x1, y1 = bbox
    boxes = [(x0, y0, x1, y1)] if x0 <= x1 else [(x0, y0, 180.0, y1), (-180.0, y0, x1, y1)]
    shapes = [h3.LatLngPoly([(b[1], b[0]), (b[1], b[2]), (b[3], b[2]), (b[3], b[0])]) for b in boxes]
    best: list[str] = []
    best_res = 0
    for r in range(0, min(native_res) + 1):
        cells: set[str] = set()
        for s in shapes:
            cells.update(h3.h3shape_to_cells_experimental(s, r, contain="overlap"))
            if len(cells) > max_ranges:
                break
        if len(cells) > max_ranges:
            break
        best, best_res = sorted(cells), r
    ranges = [child_ranges(p, rr) for p in best for rr in native_res]
    return best_res, ranges


# --- aggregation helpers ----------------------------------------------------------------

def agg_sql(agg: str, value: sql.Composable | None, weight: sql.Composable | None) -> sql.Composable:
    if agg == "count":
        return sql.SQL("sum({w})::float8").format(w=weight) if weight is not None else sql.SQL("count(*)::float8")
    if value is None:
        raise validation_error("'value' is required for this aggregation.")
    v = sql.SQL("{}::float8").format(value)
    if agg == "sum":
        return sql.SQL("sum({v} * {w})").format(v=v, w=weight) if weight is not None else sql.SQL("sum({})").format(v)
    if agg == "avg":
        if weight is not None:
            return sql.SQL("sum({v} * {w}) / NULLIF(sum({w}), 0)").format(v=v, w=weight)
        return sql.SQL("avg({})").format(v)
    if agg == "min":
        return sql.SQL("min({})").format(v)
    if agg == "max":
        return sql.SQL("max({})").format(v)
    return sql.SQL("percentile_cont(0.5) WITHIN GROUP (ORDER BY {})").format(v)


def cell_stats(values: list[float]) -> dict:
    vals = sorted(v for v in values if v is not None and math.isfinite(v))
    if not vals:
        return {"min": None, "max": None, "mean": None, "quantiles": None}

    def q(p: float) -> float:
        i = p * (len(vals) - 1)
        lo, hi = math.floor(i), math.ceil(i)
        return vals[lo] + (vals[hi] - vals[lo]) * (i - lo)

    return {"min": vals[0], "max": vals[-1], "mean": statistics.fmean(vals),
            "quantiles": {"p05": q(0.05), "p25": q(0.25), "p50": q(0.5), "p75": q(0.75), "p95": q(0.95)}}


def _numeric_col(info: TableInfo, name: str | None, what: str) -> sql.Composable | None:
    if name is None:
        return None
    c = col_info(info, name)
    if c["udt"] not in NUMERIC:
        raise validation_error(f"'{what}' must be a numeric column.", column=name)
    return sql.Identifier(name)


def _check_args(settings: Settings, resolution: int, max_cells: int | None, agg: str, value: str | None) -> int:
    if agg not in AGGS:
        raise validation_error("Unknown aggregation.", allowed=list(AGGS))
    if agg != "count" and value is None:
        raise validation_error("'value' is required unless agg=count.")
    cap = max_cells if max_cells is not None else settings.max_h3_cells
    if cap < 1 or cap > settings.max_h3_cells:
        raise validation_error("maxCells out of range.", max=settings.max_h3_cells)
    return cap


# --- /h3/cells : existing H3 table -----------------------------------------------------------

async def native_resolutions(conn: AsyncConnection, info: TableInfo, hc: H3Column, sample: int = 20_000) -> list[int]:
    q = sql.SQL("SELECT DISTINCT {r} AS r FROM (SELECT {c} AS v FROM {t} WHERE {c} IS NOT NULL LIMIT {n}) s ORDER BY 1").format(
        r=resolution_expr(sql.Identifier("v")), c=hc.as_bigint, t=table_ref(info), n=sql.Literal(sample))
    return [r["r"] for r in await (await conn.execute(q)).fetchall()]


async def h3_cells(conn: AsyncConnection, settings: Settings, info: TableInfo, *, column: str | None, resolution: int | None,
                   bbox: Any, value: str | None, agg: str, filter_raw: Any, max_cells: int | None) -> dict:
    hc = default_h3_column(info, column)
    cap = _check_args(settings, resolution or 0, max_cells, agg, value)
    val = _numeric_col(info, value, "value")
    res_present = await native_resolutions(conn, info, hc)
    if not res_present:
        return {"resolution": resolution, "nativeResolution": None, "requestedResolution": resolution, "cells": [],
                "stats": cell_stats([]), "truncated": False, "coarsened": False}
    native = max(res_present)
    req = resolution if resolution is not None else native
    target = min(req, native)  # never invent children: finer than the data is not possible
    q = Q()
    where: list[sql.Composable] = [sql.SQL("{} IS NOT NULL").format(hc.ident)]
    if bbox is not None:
        bb = parse_bbox(bbox)
        geoms = [g for g in info.geometry]
        if geoms:
            where.append(bbox_predicate(q, geoms[0], bb))
        else:
            _, ranges = covering_ranges(bb, res_present)
            where.append(hc.range_pred(ranges, q))
    f = compile_filter(info, settings, q, filter_raw, info.geometry[0] if info.geometry else None)
    if f is not None:
        where.append(f)
    base_params = list(q.params)
    base_where = sql.SQL(" AND ").join(where)
    a = agg_sql(agg, val, None)
    used = target
    rows: list[dict] = []
    while True:
        query = sql.SQL("SELECT {cell} AS cell, {a} AS v, count(*) AS n FROM {t} WHERE {w} AND {res} >= {p} GROUP BY 1 LIMIT {lim}").format(
            cell=parent_expr(hc.as_bigint, used), a=a, t=table_ref(info), w=base_where, res=resolution_expr(hc.as_bigint),
            p=sql.Literal(used), lim=sql.Literal(cap + 1))
        rows = await (await conn.execute(query, base_params)).fetchall()
        if len(rows) <= cap or used == 0:
            break
        used -= 1
    truncated = len(rows) > cap
    rows = rows[:cap]
    cells = [{"h3": hex_of_bigint(r["cell"]), "value": r["v"], "count": r["n"]} for r in rows]
    return {"resolution": used, "nativeResolution": native, "requestedResolution": req, "cells": cells,
            "stats": cell_stats([c["value"] for c in cells]), "truncated": truncated, "coarsened": used < target,
            "engine": "sql"}


async def h3_resolutions(conn: AsyncConnection, settings: Settings, info: TableInfo, column: str | None) -> dict:
    hc = default_h3_column(info, column)
    sampled = info.est_rows is not None and info.est_rows > 1_000_000
    lim = sql.SQL(" LIMIT 1000000") if sampled else sql.SQL("")
    q = sql.SQL("SELECT {r} AS r, count(*) AS n FROM (SELECT {c} AS v FROM {t} WHERE {c} IS NOT NULL{lim}) s GROUP BY 1 ORDER BY 1").format(
        r=resolution_expr(sql.Identifier("v")), c=hc.as_bigint, t=table_ref(info), lim=lim)
    async with conn.transaction():
        await conn.execute(sql.SQL("SET LOCAL statement_timeout = {}").format(sql.Literal(min(settings.statement_timeout_ms, 20_000))))
        rows = await (await conn.execute(q)).fetchall()
    return {"column": hc.name, "storage": hc.storage, "sampled": sampled,
            "resolutions": [{"resolution": r["r"], "count": r["n"]} for r in rows]}


# --- /h3/aggregate : points / geometries -> cells --------------------------------------------------

def point_expr(g: GeomColumn, assumed: int | None) -> sql.Composable:
    """Geometry point in 4326 (centroid for non-point types)."""
    col: sql.Composable = sql.Identifier(g.name)
    if g.storage == "geography":
        geom = sql.SQL("{}::geometry").format(col)
    else:
        srid = effective_srid(g, assumed)
        base = sql.SQL("ST_SetSRID({}, {})").format(col, sql.Literal(srid)) if g.srid == 0 else col
        geom = base if srid == 4326 else sql.SQL("ST_Transform({}, 4326)").format(base)
    if not g.type.lower().endswith("point"):
        geom = sql.SQL("ST_Centroid({})").format(geom)
    return geom


def bin_points(points: Iterable[tuple], res: int, agg: str) -> dict[str, tuple[float | None, int]]:
    """points: (lat, lng, value, weight). Returns cell -> (aggregated value, row count)."""
    acc: dict[str, list] = defaultdict(lambda: [0, 0.0, 0.0, None, None, 0.0, []])  # n, sum(v*w), sum(w), min, max, sumv, list
    for lat, lng, v, w in points:
        cell = h3.latlng_to_cell(lat, lng, res)
        a = acc[cell]
        a[0] += 1
        ww = 1.0 if w is None else w
        if v is not None:
            a[1] += v * ww
            a[5] += v
            a[3] = v if a[3] is None or v < a[3] else a[3]
            a[4] = v if a[4] is None or v > a[4] else a[4]
        a[2] += ww
        if agg == "median" and v is not None:
            a[6].append(v)
    out: dict[str, tuple[float | None, int]] = {}
    weighted = any(w is not None for *_, w in points) if isinstance(points, list) else False
    for cell, a in acc.items():
        if agg == "count":
            val: float | None = a[2] if weighted else float(a[0])
        elif agg == "sum":
            val = a[1] if weighted else a[5]
        elif agg == "avg":
            val = (a[1] / a[2] if a[2] else None) if weighted else (a[5] / a[0] if a[0] else None)
        elif agg == "min":
            val = a[3]
        elif agg == "max":
            val = a[4]
        else:
            val = statistics.median(a[6]) if a[6] else None
        out[cell] = (val, a[0])
    return out


async def h3_aggregate(conn: AsyncConnection, settings: Settings, info: TableInfo, *, use_sql: bool, geometry_column: str | None,
                       resolution: int, bbox: Any, value: str | None, agg: str, weight: str | None, filter_raw: Any,
                       max_cells: int | None, assumed_srid: int | None) -> dict:
    g = pick_geometry(info, geometry_column)
    cap = _check_args(settings, resolution, max_cells, agg, value)
    val = _numeric_col(info, value, "value")
    wgt = _numeric_col(info, weight, "weight")
    q = Q()
    where: list[sql.Composable] = [sql.SQL("{} IS NOT NULL").format(sql.Identifier(g.name))]
    if bbox is not None:
        where.append(bbox_predicate(q, g, parse_bbox(bbox), assumed_srid))
    f = compile_filter(info, settings, q, filter_raw, g, assumed_srid)
    if f is not None:
        where.append(f)
    params = list(q.params)
    w = sql.SQL(" AND ").join(where)
    pt = point_expr(g, assumed_srid)
    used = resolution
    scan_limited = False
    if use_sql:
        a = agg_sql(agg, val, wgt)
        while True:
            cell = sql.SQL("h3_latlng_to_cell(point(ST_X({p}), ST_Y({p})), {r})::bigint").format(p=pt, r=sql.Literal(used))
            query = sql.SQL("SELECT {cell} AS cell, {a} AS v, count(*) AS n FROM {t} WHERE {w} GROUP BY 1 LIMIT {lim}").format(
                cell=cell, a=a, t=table_ref(info), w=w, lim=sql.Literal(cap + 1))
            rows = await (await conn.execute(query, params)).fetchall()
            if len(rows) <= cap or used == 0:
                break
            used -= 1
        cells = [{"h3": hex_of_bigint(r["cell"]), "value": r["v"], "count": r["n"]} for r in rows[:cap]]
        truncated = len(rows) > cap
        engine = "sql"
    else:
        sel = [sql.SQL("ST_Y({p}) AS lat").format(p=pt), sql.SQL("ST_X({p}) AS lng").format(p=pt),
               sql.SQL("{}::float8 AS v").format(val) if val is not None else sql.SQL("NULL::float8 AS v"),
               sql.SQL("{}::float8 AS w").format(wgt) if wgt is not None else sql.SQL("NULL::float8 AS w")]
        scan = settings.max_h3_scan_rows
        query = sql.SQL("SELECT {sel} FROM {t} WHERE {w} LIMIT {lim}").format(
            sel=sql.SQL(", ").join(sel), t=table_ref(info), w=w, lim=sql.Literal(scan + 1))
        got = await (await conn.execute(query, params)).fetchall()
        scan_limited = len(got) > scan
        pts = [(r["lat"], r["lng"], r["v"], r["w"]) for r in got[:scan] if r["lat"] is not None and r["lng"] is not None]
        while True:
            binned = bin_points(pts, used, agg)
            if len(binned) <= cap or used == 0:
                break
            used -= 1
        items = list(binned.items())
        truncated = len(items) > cap
        cells = [{"h3": c, "value": v, "count": n} for c, (v, n) in items[:cap]]
        engine = "python"
    return {"resolution": used, "requestedResolution": resolution, "cells": cells, "stats": cell_stats([c["value"] for c in cells]),
            "truncated": truncated or scan_limited, "coarsened": used < resolution, "engine": engine,
            **({"scanLimited": True} if scan_limited else {})}


# --- stateless helpers -----------------------------------------------------------------------------------

def polyfill(settings: Settings, geometry: dict, resolution: int, mode: str) -> dict:
    validate_geojson(geometry, settings.max_geometry_vertices)
    if geometry["type"] not in ("Polygon", "MultiPolygon"):
        raise validation_error("polyfill needs a Polygon or MultiPolygon.")
    polys = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    # refuse before computing: estimate the cell count from the bounding box area
    xs = [p[0] for poly in polys for ring in poly for p in ring]
    ys = [p[1] for poly in polys for ring in poly for p in ring]
    area = (max(xs) - min(xs)) * 111.32 * math.cos(math.radians((max(ys) + min(ys)) / 2)) * (max(ys) - min(ys)) * 110.57
    est = area / h3.average_hexagon_area(resolution, unit="km^2")
    if est > settings.max_h3_cells * 1.5:
        raise ApiError(413, "payload_too_large", "The area would need too many cells at this resolution.",
                       {"estimatedCells": int(est), "maxCells": settings.max_h3_cells})
    cells: set[str] = set()
    for poly in polys:
        shape = h3.LatLngPoly([(p[1], p[0]) for p in poly[0][:-1]], *[[(p[1], p[0]) for p in hole[:-1]] for hole in poly[1:]])
        if mode == "center":
            cells.update(h3.h3shape_to_cells(shape, resolution))
        else:
            cells.update(h3.h3shape_to_cells_experimental(shape, resolution, contain=mode))
        if len(cells) > settings.max_h3_cells:
            raise ApiError(413, "payload_too_large", "Too many cells.", {"maxCells": settings.max_h3_cells})
    return {"resolution": resolution, "mode": mode, "cells": sorted(cells)}


def cell_info(cell: str) -> dict:
    check_cell(cell)
    res = h3.get_resolution(cell)
    lat, lng = h3.cell_to_latlng(cell)
    ring = [[p[1], p[0]] for p in h3.cell_to_boundary(cell)]
    return {"h3": cell, "resolution": res, "center": {"lat": lat, "lng": lng}, "boundary": ring + [ring[0]],
            "area_km2": h3.cell_area(cell, unit="km^2"), "isPentagon": h3.is_pentagon(cell),
            "parent": h3.cell_to_parent(cell, res - 1) if res > 0 else None}


def children(cell: str, resolution: int) -> dict:
    check_cell(cell)
    res = h3.get_resolution(cell)
    if resolution <= res:
        raise validation_error("resolution must be finer than the cell's resolution.", cellResolution=res)
    if resolution - res > MAX_CHILD_DELTA:
        raise validation_error(f"At most {MAX_CHILD_DELTA} resolutions below the cell are allowed.", cellResolution=res)
    return {"cell": cell, "resolution": resolution, "cells": sorted(h3.cell_to_children(cell, resolution))}
