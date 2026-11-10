"""Safe SQL composition: identifiers only via ``psycopg.sql.Identifier`` after catalogue
verification, values only as bound parameters. Nothing here accepts SQL text from callers."""
from __future__ import annotations

import json
import math
from typing import Any

from psycopg import sql

from ..config import Settings
from ..errors import bad_request, invalid_filter, validation_error
from .discovery import GeomColumn, TableInfo

NUMERIC = {"int2", "int4", "int8", "float4", "float8", "numeric", "oid"}
TEXTUAL = {"text", "varchar", "bpchar", "name", "citext"}
GEO = {"geometry", "geography"}
MAX_Y_3857 = 85.0511


class Q:
    """Collects bound parameters in emission order and hands out placeholders."""

    def __init__(self) -> None:
        self.params: list[Any] = []

    def add(self, value: Any) -> sql.Composable:
        self.params.append(value)
        return sql.Placeholder()


def ident(*parts: str) -> sql.Composable:
    return sql.SQL(".").join(sql.Identifier(p) for p in parts)


def table_ref(info: TableInfo) -> sql.Composable:
    return ident(info.schema, info.name)


def col_info(info: TableInfo, name: Any) -> dict:
    if not isinstance(name, str):
        raise invalid_filter("Column must be a string.")
    for c in info.columns:
        if c["name"] == name:
            return c
    raise invalid_filter(f"Unknown column '{name[:64]}'", column=name[:64])


def attribute_columns(info: TableInfo, requested: list[str] | None) -> list[dict]:
    """Columns to return as properties: requested (validated) or all non-spatial, non-binary ones."""
    if requested is not None:
        out = []
        for n in requested:
            c = col_info(info, n)
            if c["udt"] in GEO or c["udt"] == "bytea":
                raise validation_error("Spatial and binary columns cannot be requested as attributes.", column=n)
            out.append(c)
        return out
    return [c for c in info.columns if c["udt"] not in GEO and c["udt"] != "bytea"]


def effective_srid(g: GeomColumn, assumed: int | None) -> int:
    if g.storage == "geography":
        return g.srid or 4326
    srid = g.srid or (assumed or 0)
    if srid == 0:
        raise validation_error("The geometry column has an unknown SRID (0). Pass assumedSrid to use it.",
                               column=g.name)
    return srid


def parse_bbox(value: Any) -> tuple[float, float, float, float]:
    try:
        parts = [float(x) for x in (value.split(",") if isinstance(value, str) else value)]
    except (TypeError, ValueError):
        raise bad_request("bbox must be minLon,minLat,maxLon,maxLat")
    if len(parts) != 4 or not all(math.isfinite(p) for p in parts):
        raise bad_request("bbox must be minLon,minLat,maxLon,maxLat")
    x0, y0, x1, y1 = parts
    if not (-180 <= x0 <= 180 and -180 <= x1 <= 180 and -90 <= y0 <= 90 and -90 <= y1 <= 90) or y0 > y1:
        raise bad_request("bbox out of range (lon -180..180, lat -90..90, minLat <= maxLat)")
    return x0, y0, x1, y1


def _envelopes(q: Q, bbox: tuple[float, float, float, float], srid: int) -> list[sql.Composable]:
    x0, y0, x1, y1 = bbox
    if srid == 3857:
        y0, y1 = max(y0, -MAX_Y_3857), min(y1, MAX_Y_3857)
    boxes = [(x0, y0, x1, y1)] if x0 <= x1 else [(x0, y0, 180.0, y1), (-180.0, y0, x1, y1)]  # antimeridian
    return [sql.SQL("ST_MakeEnvelope({},{},{},{},4326)").format(q.add(a), q.add(b), q.add(c), q.add(d))
            for a, b, c, d in boxes]


def bbox_predicate(q: Q, g: GeomColumn, bbox: tuple[float, float, float, float], assumed: int | None = None,
                   exact: bool = True) -> sql.Composable:
    """Index-friendly bbox test: the *envelope* is transformed to the column SRID, never the column."""
    srid = effective_srid(g, assumed)
    col = sql.Identifier(g.name)
    parts = []
    for env in _envelopes(q, bbox, srid):
        if g.storage == "geography":
            parts.append(sql.SQL("ST_Intersects({}, {}::geography)").format(col, env))
            continue
        t = env if srid == 4326 else sql.SQL("ST_Transform({}, {})").format(env, sql.Literal(srid))
        if g.srid == 0:
            t = sql.SQL("ST_SetSRID({}, 0)").format(t)
        parts.append(sql.SQL("ST_Intersects({}, {})").format(col, t) if exact else sql.SQL("{} && {}").format(col, t))
    return parts[0] if len(parts) == 1 else sql.SQL("({})").format(sql.SQL(" OR ").join(parts))


def geojson_output(g: GeomColumn, assumed: int | None, tolerance: float | None, binary: bool = False) -> sql.Composable:
    """GeoJSON text of the geometry in 4326, optionally simplified (on the *output*, not in WHERE)."""
    col: sql.Composable = sql.Identifier(g.name)
    if g.storage == "geography":
        geom = sql.SQL("{}::geometry").format(col)
    else:
        srid = effective_srid(g, assumed)
        base = sql.SQL("ST_SetSRID({}, {})").format(col, sql.Literal(srid)) if g.srid == 0 else col
        geom = base if srid == 4326 else sql.SQL("ST_Transform({}, 4326)").format(base)
    if tolerance and not g.type.lower().endswith("point"):
        geom = sql.SQL("ST_SimplifyPreserveTopology({}, {})").format(geom, sql.Literal(float(tolerance)))
    return sql.SQL("ST_AsBinary({})" if binary else "ST_AsGeoJSON({}, 6)").format(geom)


def zoom_tolerance(zoom: float) -> float:
    """Half a 256px-tile pixel in degrees at this zoom."""
    return 360.0 / (256.0 * 2.0 ** zoom) / 2.0


def jsonable(v: Any) -> Any:
    import datetime as dt
    import decimal
    import uuid

    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, decimal.Decimal):
        return float(v) if v.is_finite() else None
    if isinstance(v, (dt.datetime, dt.date, dt.time)):
        return v.isoformat()
    if isinstance(v, (uuid.UUID, dt.timedelta)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    return str(v)


def dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
