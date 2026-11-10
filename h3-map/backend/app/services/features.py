"""GeoJSON feature queries (bbox / filter / keyset) and single-feature lookup."""
from __future__ import annotations

import json
from typing import Any

from psycopg import AsyncConnection, sql

from ..config import Settings
from ..errors import ApiError, bad_request, not_found, validation_error
from .discovery import GeomColumn, TableInfo, pick_geometry
from .filters import compile_filter, validate_geojson
from .query_builder import (NUMERIC, Q, attribute_columns, bbox_predicate, dumps, geojson_output, jsonable,
                            parse_bbox, table_ref, zoom_tolerance)

FID = "__h3m_fid"
GEOM = "__h3m_geom"


def pk_column(info: TableInfo) -> dict | None:
    if len(info.primary_key) != 1:
        return None
    return next(c for c in info.columns if c["name"] == info.primary_key[0])


def coerce_pk(c: dict, value: Any) -> Any:
    if c["udt"] in NUMERIC:
        try:
            return int(value)
        except (TypeError, ValueError):
            try:
                return float(value)
            except (TypeError, ValueError):
                raise bad_request("The id/cursor does not match the primary key type.")
    return str(value)


def resolve_tolerance(simplify: float | str | None, zoom: float | None) -> float | None:
    if simplify is None:
        return None
    if simplify == "auto":
        return zoom_tolerance(zoom) if zoom is not None and zoom < 18 else None
    return float(simplify) or None


async def query_features(conn: AsyncConnection, settings: Settings, info: TableInfo, *, geometry_column: str | None = None,
                         bbox: Any = None, columns: list[str] | None = None, filter_raw: Any = None,
                         spatial: dict | None = None, simplify: float | str | None = None, zoom: float | None = None,
                         limit: int | None = None, after: Any = None, paginate: bool = False,
                         assumed_srid: int | None = None) -> dict:
    g = pick_geometry(info, geometry_column)
    limit = limit or settings.default_features
    if limit > settings.max_features:
        raise validation_error("limit exceeds the maximum.", max=settings.max_features)
    bb = parse_bbox(bbox) if bbox is not None else None
    if bb is None and info.est_rows is not None and info.est_rows > settings.max_features_no_bbox:
        raise ApiError(400, "bad_request", "A bbox is required for tables this large.",
                       {"estimatedRows": info.est_rows, "maxFeaturesNoBbox": settings.max_features_no_bbox, "param": "bbox"})
    attrs = attribute_columns(info, columns)
    pk = pk_column(info)
    q = Q()
    tol = resolve_tolerance(simplify, zoom)

    select = [sql.SQL("{} AS {}").format(sql.Identifier(c["name"]), sql.Identifier(f"p{i}")) for i, c in enumerate(attrs)]
    if pk is not None:
        select.append(sql.SQL("{} AS {}").format(sql.Identifier(pk["name"]), sql.Identifier(FID)))
    select.append(sql.SQL("{} AS {}").format(geojson_output(g, assumed_srid, tol), sql.Identifier(GEOM)))

    where: list[sql.Composable] = []
    if bb is not None:
        where.append(bbox_predicate(q, g, bb, assumed_srid))
    f = compile_filter(info, settings, q, filter_raw, g, assumed_srid)
    if f is not None:
        where.append(f)
    if spatial is not None:
        if not isinstance(spatial, dict) or spatial.get("op", "intersects") != "intersects":
            raise validation_error("spatial.op must be 'intersects'.")
        where.append(compile_filter(info, settings, q, {"op": "intersects", "geometry": spatial.get("geometry")}, g, assumed_srid))
    ordered = pk is not None and (paginate or after is not None)
    if after is not None:
        if pk is None:
            raise validation_error("Cursor pagination needs a single-column primary key.")
        where.append(sql.SQL("{} > {}").format(sql.Identifier(pk["name"]), q.add(coerce_pk(pk, after))))
    query = sql.SQL("SELECT {} FROM {}").format(sql.SQL(", ").join(select), table_ref(info))
    if where:
        query += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(where)
    if ordered:
        query += sql.SQL(" ORDER BY {}").format(sql.Identifier(pk["name"]))
    query += sql.SQL(" LIMIT {}").format(q.add(limit + 1))

    cur = await conn.execute(query, q.params)
    rows = await cur.fetchall()
    truncated = len(rows) > limit
    rows = rows[:limit]
    return {"rows": rows, "attrs": attrs, "pk": pk, "truncated": truncated, "limit": limit, "ordered": ordered}


def to_geojson(result: dict) -> str:
    feats = []
    for r in result["rows"]:
        props = {c["name"]: jsonable(r[f"p{i}"]) for i, c in enumerate(result["attrs"])}
        f: dict[str, Any] = {"type": "Feature", "geometry": json.loads(r[GEOM]) if r[GEOM] else None, "properties": props}
        if result["pk"] is not None:
            f["id"] = jsonable(r[FID])
        feats.append(f)
    next_cursor = None
    if result["truncated"] and result["ordered"] and feats:
        next_cursor = feats[-1].get("id")
    body = {"type": "FeatureCollection", "features": feats,
            "page": {"limit": result["limit"], "nextCursor": next_cursor}, "truncated": result["truncated"]}
    return dumps(body)


async def get_feature(conn: AsyncConnection, settings: Settings, info: TableInfo, fid: str, geometry_column: str | None,
                      columns: list[str] | None, assumed_srid: int | None) -> dict:
    pk = pk_column(info)
    if pk is None:
        raise validation_error("The table needs a single-column primary key to fetch a feature by id.")
    g = pick_geometry(info, geometry_column)
    attrs = attribute_columns(info, columns)
    q = Q()
    select = [sql.SQL("{} AS {}").format(sql.Identifier(c["name"]), sql.Identifier(f"p{i}")) for i, c in enumerate(attrs)]
    select.append(sql.SQL("{} AS {}").format(sql.Identifier(pk["name"]), sql.Identifier(FID)))
    select.append(sql.SQL("{} AS {}").format(geojson_output(g, assumed_srid, None), sql.Identifier(GEOM)))
    query = sql.SQL("SELECT {} FROM {} WHERE {} = {} LIMIT 1").format(
        sql.SQL(", ").join(select), table_ref(info), sql.Identifier(pk["name"]), q.add(coerce_pk(pk, fid)))
    row = await (await conn.execute(query, q.params)).fetchone()
    if row is None:
        raise not_found("Feature not found.", id=fid)
    res = {"rows": [row], "attrs": attrs, "pk": pk, "truncated": False, "limit": 1, "ordered": False}
    return json.loads(to_geojson(res))["features"][0]
