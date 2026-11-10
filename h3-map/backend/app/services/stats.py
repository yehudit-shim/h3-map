"""Rows preview, column statistics and filtered extent (P6-06)."""
from __future__ import annotations

import math
from typing import Any

from psycopg import AsyncConnection, sql

from ..config import Settings
from ..errors import bad_request, validation_error
from .discovery import TableInfo, pick_geometry
from .features import coerce_pk, pk_column
from .filters import compile_filter
from .profile import extent as profile_extent
from .query_builder import GEO, NUMERIC, Q, col_info, jsonable, table_ref

MAX_OFFSET = 100_000
WKT_CHARS = 200
QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)
ORDERABLE_SKIP = GEO | {"bytea", "json", "jsonb"}


def parse_sort(info: TableInfo, sort: str | None) -> tuple[dict, bool] | None:
    if not sort:
        return None
    desc = sort.startswith("-")
    c = col_info(info, sort[1:] if desc else sort)
    if c["udt"] in ORDERABLE_SKIP:
        raise validation_error("This column cannot be used for sorting.", column=c["name"])
    return c, desc


async def rows(conn: AsyncConnection, settings: Settings, info: TableInfo, *, limit: int, offset: int, after: Any,
               sort: str | None, columns: list[str] | None, filter_raw: Any, include_geometry: bool) -> dict:
    if limit < 1 or limit > settings.max_rows_limit:
        raise validation_error("limit out of range.", max=settings.max_rows_limit)
    if offset < 0 or offset > MAX_OFFSET:
        raise validation_error("offset out of range; use 'after' for deep paging.", max=MAX_OFFSET)
    if columns is not None:
        cols = [col_info(info, n) for n in columns]
    else:
        cols = [c for c in info.columns if c["udt"] not in GEO and c["udt"] != "bytea"]
    geoms = []
    if include_geometry:
        geoms = [c for c in info.columns if c["udt"] in GEO] if columns is None else [c for c in cols if c["udt"] in GEO]
        cols = [c for c in cols if c["udt"] not in GEO]
    elif columns is not None:
        cols = [c for c in cols if c["udt"] not in GEO]
    pk = pk_column(info)
    srt = parse_sort(info, sort)
    q = Q()
    select = [sql.Identifier(c["name"]) for c in cols]
    select += [sql.SQL("LEFT(ST_AsText({}::geometry), {}) AS {}").format(sql.Identifier(g["name"]), sql.Literal(WKT_CHARS), sql.Identifier(g["name"]))
               for g in geoms]
    if pk is not None and pk["name"] not in {c["name"] for c in cols}:
        select.append(sql.SQL("{} AS {}").format(sql.Identifier(pk["name"]), sql.Identifier("__pk")))
    where: list[sql.Composable] = []
    f = compile_filter(info, settings, q, filter_raw, info.geometry[0] if info.geometry else None)
    if f is not None:
        where.append(f)
    order: list[sql.Composable] = []
    keyset = after is not None
    if keyset:
        if pk is None:
            raise validation_error("Cursor paging needs a single-column primary key.")
        if srt is not None and srt[0]["name"] != pk["name"]:
            raise validation_error("'after' can only be combined with sorting by the primary key.")
        if offset:
            raise validation_error("Use either 'after' or 'offset'.")
        desc = bool(srt and srt[1])
        where.append(sql.SQL("{} {} {}").format(sql.Identifier(pk["name"]), sql.SQL("<" if desc else ">"), q.add(coerce_pk(pk, after))))
        order.append(sql.SQL("{} {}").format(sql.Identifier(pk["name"]), sql.SQL("DESC" if desc else "ASC")))
    else:
        if srt is not None:
            order.append(sql.SQL("{} {} NULLS LAST").format(sql.Identifier(srt[0]["name"]), sql.SQL("DESC" if srt[1] else "ASC")))
        if pk is not None and (srt is None or srt[0]["name"] != pk["name"]):
            order.append(sql.Identifier(pk["name"]))
    query = sql.SQL("SELECT {} FROM {}").format(sql.SQL(", ").join(select), table_ref(info))
    if where:
        query += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(where)
    if order:
        query += sql.SQL(" ORDER BY ") + sql.SQL(", ").join(order)
    query += sql.SQL(" LIMIT {} OFFSET {}").format(q.add(limit + 1), q.add(offset))
    got = await (await conn.execute(query, q.params)).fetchall()
    more = len(got) > limit
    got = got[:limit]
    names = [c["name"] for c in cols] + [g["name"] for g in geoms]
    out = [[jsonable(r[n]) for n in names] for r in got]
    nxt = None
    if more and keyset or (more and pk is not None and offset == 0 and (srt is None or srt[0]["name"] == pk["name"])):
        last = got[-1]
        nxt = jsonable(last[pk["name"]] if pk["name"] in last else last["__pk"])
    return {"columns": [{"name": c["name"], "type": c["type"]} for c in cols] + [{"name": g["name"], "type": "wkt"} for g in geoms],
            "rows": out, "page": {"limit": limit, "offset": offset, "nextCursor": nxt, "hasMore": more}}


async def column_stats(conn: AsyncConnection, settings: Settings, info: TableInfo, column: str, bins: int,
                       filter_raw: Any) -> dict:
    c = col_info(info, column)
    udt = c["udt"]
    if udt in ORDERABLE_SKIP:
        raise validation_error("Statistics are not available for this column type.", column=column)
    numeric = udt in NUMERIC
    col = sql.Identifier(column)
    q = Q()
    f = compile_filter(info, settings, q, filter_raw, info.geometry[0] if info.geometry else None)
    where = sql.SQL(" WHERE ") + f if f is not None else sql.SQL("")
    src = sql.SQL("FROM {}{}").format(table_ref(info), where)
    base_params = list(q.params)
    out: dict[str, Any] = {"column": column, "type": c["type"], "mean": None, "stddev": None, "quantiles": None,
                           "histogram": None}
    async with conn.transaction():
        await conn.execute(sql.SQL("SET LOCAL statement_timeout = {}").format(sql.Literal(min(settings.statement_timeout_ms, 20_000))))
        if numeric:
            cols = sql.SQL("count({c}) AS n, count(*) - count({c}) AS nulls, min({c})::float8 AS mn, max({c})::float8 AS mx, "
                           "avg({c})::float8 AS mean, stddev_samp({c})::float8 AS sd, count(DISTINCT {c}) AS distinct_n, "
                           "percentile_cont({qs}::float8[]) WITHIN GROUP (ORDER BY {c}::float8) AS qs").format(
                c=col, qs=sql.Literal(list(QUANTILES)))
        else:
            cols = sql.SQL("count({c}) AS n, count(*) - count({c}) AS nulls, min({c}::text) AS mn, max({c}::text) AS mx, "
                           "count(DISTINCT {c}) AS distinct_n").format(c=col)
        r = await (await conn.execute(sql.SQL("SELECT {} {}").format(cols, src), base_params)).fetchone()
        out.update(count=r["n"], nulls=r["nulls"], min=jsonable(r["mn"]), max=jsonable(r["mx"]), distinct=r["distinct_n"])
        if numeric and r["n"]:
            out["mean"], out["stddev"] = jsonable(r["mean"]), jsonable(r["sd"])
            out["quantiles"] = {f"p{int(p * 100):02d}": jsonable(v) for p, v in zip(QUANTILES, r["qs"])}
            lo, hi = r["mn"], r["mx"]
            if lo == hi:
                out["histogram"] = [{"from": lo, "to": hi, "count": r["n"]}]
            else:
                hq = sql.SQL("SELECT LEAST(width_bucket({c}::float8, {lo}, {hi}, {b}), {b}) AS b, count(*) AS n {src} {sep} {c} IS NOT NULL "
                             "GROUP BY 1 ORDER BY 1").format(c=col, lo=sql.Literal(lo), hi=sql.Literal(hi), b=sql.Literal(bins), src=src,
                                                              sep=sql.SQL("AND" if f is not None else "WHERE"))
                counts = {x["b"]: x["n"] for x in await (await conn.execute(hq, base_params)).fetchall()}
                w = (hi - lo) / bins
                out["histogram"] = [{"from": lo + i * w, "to": lo + (i + 1) * w, "count": counts.get(i + 1, 0)} for i in range(bins)]
        tq = sql.SQL("SELECT {c}::text AS v, count(*) AS n {src} {sep} {c} IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT 10").format(
            c=col, src=src, sep=sql.SQL("AND" if f is not None else "WHERE"))
        out["topValues"] = [{"value": x["v"], "count": x["n"]} for x in await (await conn.execute(tq, base_params)).fetchall()]
    return out


async def table_extent(conn: AsyncConnection, settings: Settings, info: TableInfo, geometry_column: str | None,
                       filter_raw: Any, assumed_srid: int | None) -> dict:
    g = pick_geometry(info, geometry_column)
    if filter_raw is None:
        ext, reason = await profile_extent(conn, info, g, info.est_rows, assumed_srid)
        if ext is None:
            raise bad_request("The extent is not available.", reason=reason)
        return {"bbox": ext["bbox"], "srid": 4326, "sourceSrid": g.srid, "estimated": ext["estimated"]}
    from .query_builder import effective_srid
    srid = effective_srid(g, assumed_srid)
    q = Q()
    f = compile_filter(info, settings, q, filter_raw, g, assumed_srid)
    geom = sql.Identifier(g.name) if g.storage == "geometry" else sql.SQL("{}::geometry").format(sql.Identifier(g.name))
    if g.srid == 0:
        geom = sql.SQL("ST_SetSRID({}, {})").format(geom, sql.Literal(srid))
    to4326 = geom if srid == 4326 else sql.SQL("ST_Transform({}, 4326)").format(geom)
    query = sql.SQL("SELECT ST_XMin(b) AS x0, ST_YMin(b) AS y0, ST_XMax(b) AS x1, ST_YMax(b) AS y1 FROM "
                    "(SELECT ST_Extent({}) AS b FROM {} WHERE {}) q").format(to4326, table_ref(info), f)
    async with conn.transaction():
        await conn.execute(sql.SQL("SET LOCAL statement_timeout = {}").format(sql.Literal(min(settings.statement_timeout_ms, 20_000))))
        r = await (await conn.execute(query, q.params)).fetchone()
    if r["x0"] is None:
        return {"bbox": None, "srid": 4326, "sourceSrid": g.srid, "estimated": False}
    return {"bbox": [r["x0"], r["y0"], r["x1"], r["y1"]], "srid": 4326, "sourceSrid": g.srid, "estimated": False}
