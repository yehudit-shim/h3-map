"""Table profile (DATABASE_INTEGRATION section 3): SRID, extent, count, indexes, H3 candidates, strategy, warnings."""
from __future__ import annotations

import re
from collections import Counter

import h3
from psycopg import AsyncConnection, sql

from ..config import Settings
from .discovery import H3_NAME_RE, GeomColumn, TableInfo

_HEX15 = re.compile(r"^[0-9a-f]{15}$")
RES_COL_RE = re.compile(r"^(res|resolution|h3_?res(olution)?)$", re.I)
SPATIAL_METHODS = {"gist", "spgist", "brin"}


def _qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


# --- statistics / counts ----------------------------------------------------------

async def row_estimate(conn: AsyncConnection, info: TableInfo, settings: Settings) -> tuple[int | None, bool, dict | None]:
    """Return (estimated rows, stats_never_collected, stale_info)."""
    never = False
    est = info.est_rows
    if info.kind in ("view",) or (info.kind == "matview" and est is None):
        # planner estimate for views (no reltuples of their own)
        try:
            cur = await conn.execute(sql.SQL("EXPLAIN (FORMAT JSON) SELECT 1 FROM {}.{}").format(
                sql.Identifier(info.schema), sql.Identifier(info.name)))
            plan = (await cur.fetchone())["QUERY PLAN"][0]["Plan"]
            return int(plan["Plan Rows"]), False, None
        except Exception:
            return None, False, None
    if est is None:  # reltuples = -1: never analysed; bounded count instead of a full scan
        never = True
        cap = settings.threshold_bbox + 1
        async with conn.transaction():
            await conn.execute("SET LOCAL statement_timeout = 3000")
            cur = await conn.execute(sql.SQL("SELECT count(*) AS n FROM (SELECT 1 FROM {}.{} LIMIT {}) x").format(
                sql.Identifier(info.schema), sql.Identifier(info.name), sql.Literal(cap)))
            est = (await cur.fetchone())["n"]
        return est, never, None
    stale = None
    if info.kind in ("table", "partitioned"):
        cur = await conn.execute("SELECT n_live_tup, n_mod_since_analyze, last_analyze, last_autoanalyze "
                                 "FROM pg_stat_user_tables WHERE relid = %s", (info.oid,))
        s = await cur.fetchone()
        if s and (s["n_mod_since_analyze"] or 0) > max(50, 0.2 * est):
            stale = {"modifiedSinceAnalyze": s["n_mod_since_analyze"], "liveTuples": s["n_live_tup"]}
    return est, never, stale


async def exact_count(conn: AsyncConnection, info: TableInfo, timeout_ms: int = 10_000) -> int | None:
    try:
        async with conn.transaction():
            await conn.execute(sql.SQL("SET LOCAL statement_timeout = {}").format(sql.Literal(timeout_ms)))
            cur = await conn.execute(sql.SQL("SELECT count(*) AS n FROM {}.{}").format(
                sql.Identifier(info.schema), sql.Identifier(info.name)))
            return (await cur.fetchone())["n"]
    except Exception:
        return None


# --- extent ------------------------------------------------------------------------

async def extent(conn: AsyncConnection, info: TableInfo, g: GeomColumn, est_rows: int | None,
                 assumed_srid: int | None = None) -> tuple[dict | None, str | None]:
    """Return ({'bbox': [...4326], 'estimated': bool} | None, reason-if-none)."""
    srid = g.srid or assumed_srid or 0
    if g.storage == "geometry" and srid == 0:
        return None, "unknown_srid"
    raw = None
    estimated = True
    if g.storage == "geometry" and info.kind in ("table", "partitioned"):
        try:
            cur = await conn.execute(
                "SELECT ST_XMin(b) AS x0, ST_YMin(b) AS y0, ST_XMax(b) AS x1, ST_YMax(b) AS y1 FROM "
                "(SELECT ST_EstimatedExtent(%s, %s, %s)::geometry AS b) q", (info.schema, info.name, g.name))
            r = await cur.fetchone()
            if r and r["x0"] is not None:
                raw = r
        except Exception:
            raw = None
    if raw is None:
        estimated = False
        col = sql.Identifier(g.name)
        geom = col if g.storage == "geometry" else sql.SQL("{}::geometry").format(col)
        try:
            async with conn.transaction():
                await conn.execute("SET LOCAL statement_timeout = 3000")
                cur = await conn.execute(sql.SQL(
                    "SELECT ST_XMin(b) AS x0, ST_YMin(b) AS y0, ST_XMax(b) AS x1, ST_YMax(b) AS y1 FROM "
                    "(SELECT ST_Extent({g}) AS b FROM {s}.{t}) q").format(g=geom, s=sql.Identifier(info.schema),
                                                                          t=sql.Identifier(info.name)))
                raw = await cur.fetchone()
        except Exception:
            return None, "extent_unavailable"
    if raw is None or raw["x0"] is None:
        return None, "empty"
    if srid == 4326 or g.storage == "geography":
        return {"bbox": [raw["x0"], raw["y0"], raw["x1"], raw["y1"]], "estimated": estimated}, None
    cur = await conn.execute(
        """SELECT ST_XMin(e) AS x0, ST_YMin(e) AS y0, ST_XMax(e) AS x1, ST_YMax(e) AS y1 FROM (
             SELECT ST_Envelope(ST_Transform(ST_Segmentize(ST_SetSRID(ST_MakeEnvelope(%(x0)s,%(y0)s,%(x1)s,%(y1)s), %(srid)s),
                    GREATEST(%(x1)s-%(x0)s, %(y1)s-%(y0)s, 1e-9)/16.0), 4326)) AS e) q""",
        {**raw, "srid": srid})
    t = await cur.fetchone()
    return {"bbox": [t["x0"], t["y0"], t["x1"], t["y1"]], "estimated": estimated}, None


# --- indexes -----------------------------------------------------------------------

async def indexes(conn: AsyncConnection, info: TableInfo) -> list[dict]:
    cur = await conn.execute(
        """SELECT ic.relname AS name, am.amname AS method, i.indisunique AS "unique", i.indisprimary AS "primary",
                  pg_get_indexdef(i.indexrelid) AS definition,
                  COALESCE((SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum), '{}') AS columns
           FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam
           WHERE i.indrelid = %s ORDER BY ic.relname""", (info.oid,))
    geoms = {g.name for g in info.geometry}
    out = []
    for r in await cur.fetchall():
        cols = list(r["columns"])
        spatial = r["method"] in SPATIAL_METHODS and bool(geoms & set(cols))
        out.append({"name": r["name"], "method": r["method"], "columns": cols, "spatial": spatial,
                    "unique": r["unique"], "primary": r["primary"]})
    return out


# --- H3 candidates -----------------------------------------------------------------

def _valid_hex(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, int):
        if v < 0:
            return None
        v = f"{v:x}"
    v = str(v).strip().lower()
    return v if _HEX15.match(v) and h3.is_valid_cell(v) else None


async def h3_candidates(conn: AsyncConnection, info: TableInfo, max_sampled_columns: int = 6) -> list[dict]:
    res_cols = [c["name"] for c in info.columns if RES_COL_RE.match(c["name"])]
    found, sampled = [], 0
    for c in info.columns:
        udt = c["udt"]
        if udt not in ("h3index", "int8", "text", "varchar"):
            continue
        native = udt == "h3index"
        by_name = udt != "h3index" and bool(H3_NAME_RE.match(c["name"]))
        if not (native or by_name):
            if sampled >= max_sampled_columns or c["isPrimaryKey"] and udt == "int8":
                continue
            sampled += 1
        col = sql.Identifier(c["name"])
        expr = sql.SQL("{}::text").format(col) if native else col
        try:
            async with conn.transaction():
                await conn.execute("SET LOCAL statement_timeout = 2000")
                cur = await conn.execute(sql.SQL("SELECT {e} AS v FROM {s}.{t} WHERE {c} IS NOT NULL LIMIT 100").format(
                    e=expr, s=sql.Identifier(info.schema), t=sql.Identifier(info.name), c=col))
                vals = [r["v"] for r in await cur.fetchall()]
        except Exception:
            continue
        valid = [h for h in map(_valid_hex, vals) if h]
        confidence = round(len(valid) / len(vals), 3) if vals else (1.0 if native else 0.5)
        if not (native or by_name or (vals and confidence >= 0.95)):
            continue
        res = sorted({h3.get_resolution(h) for h in valid})
        entry = {"column": c["name"], "storage": "h3index" if native else ("bigint" if udt == "int8" else "text"),
                 "resolutions": res, "confidence": confidence}
        if res_cols:
            entry["resolutionColumn"] = res_cols[0]
        found.append(entry)
    return found


# --- strategy and warnings ----------------------------------------------------------

def recommend_strategy(settings: Settings, est: int | None, geom: GeomColumn | None, h3c: list[dict]) -> str | None:
    if geom is None:
        return "aggregate" if h3c else None
    n = est if est is not None else 0
    if n <= settings.threshold_json:
        return "json"
    if n <= settings.threshold_bbox:
        return "bbox"
    if n > settings.threshold_mvt and geom.type.lower().endswith("point"):
        return "aggregate"
    return "mvt"


def build_warnings(info: TableInfo, idx: list[dict], never_analysed: bool, stale: dict | None,
                   ext_reason: str | None, est: int | None) -> list[dict]:
    w: list[dict] = []
    if info.kind in ("table", "partitioned", "matview"):
        for g in info.geometry:
            if not any(i["spatial"] and g.name in i["columns"] for i in idx):
                name = f"{info.name}_{g.name}_gix"
                w.append({"code": "no_spatial_index", "column": g.name,
                          "message": f"No spatial index on {g.name}; bbox and tile queries will scan the whole table.",
                          "suggestion": f"CREATE INDEX {_qi(name)} ON {_qi(info.schema)}.{_qi(info.name)} USING gist ({_qi(g.name)});"})
    if info.kind in ("table", "partitioned") and not info.primary_key:
        w.append({"code": "no_primary_key", "message": "No primary key; feature ids for picking are unstable and keyset paging is unavailable."})
    for g in info.geometry:
        if g.srid == 0 and g.storage == "geometry":
            w.append({"code": "unknown_srid", "column": g.name, "message": "SRID is 0 (unknown); the extent cannot be placed on the map."})
        if g.type == "mixed":
            w.append({"code": "mixed_geometry_types", "column": g.name, "message": "The column holds several geometry types."})
    if never_analysed:
        w.append({"code": "never_analysed", "message": "The table has never been analysed; row estimates are approximate. Run ANALYZE.",
                  "suggestion": f"ANALYZE {_qi(info.schema)}.{_qi(info.name)};"})
    if stale:
        w.append({"code": "stale_statistics", "message": "Statistics are stale; the row estimate and extent may be off. Run ANALYZE.",
                  "suggestion": f"ANALYZE {_qi(info.schema)}.{_qi(info.name)};"})
    if ext_reason == "extent_unavailable":
        w.append({"code": "extent_unavailable", "message": "The extent could not be computed in time."})
    return w


async def build_profile(conn: AsyncConnection, info: TableInfo, settings: Settings, exact: bool = False,
                        assumed_srid: int | None = None) -> dict:
    est, never, stale = await row_estimate(conn, info, settings)
    idx = await indexes(conn, info)
    h3c = await h3_candidates(conn, info)
    geom = info.geometry[0] if info.geometry else None
    ext, reason = (None, None)
    if geom is not None:
        ext, reason = await extent(conn, info, geom, est, assumed_srid)
    exact_rows = await exact_count(conn, info) if exact else None
    return {
        "schema": info.schema, "table": info.name, "kind": info.kind,
        "estimatedRows": est, "exactRows": exact_rows, "comment": info.comment,
        "primaryKey": info.primary_key,
        "columns": [{"name": c["name"], "type": c["type"], "nullable": c["nullable"], "isPrimaryKey": c["isPrimaryKey"],
                     "comment": c["comment"]} for c in info.columns],
        "geometry": [{"column": g.name, "type": g.type, "srid": g.srid, "dims": g.dims, "storage": g.storage}
                     for g in info.geometry],
        "h3": h3c, "extent": ext, "indexes": idx,
        "recommendedStrategy": recommend_strategy(settings, exact_rows if exact_rows is not None else est, geom, h3c),
        "warnings": build_warnings(info, idx, never, stale, reason, est),
    }
