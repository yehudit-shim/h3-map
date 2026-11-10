"""MVT tile sessions and tile generation (ST_AsMVT / ST_AsMVTGeom).

A session freezes {connection, table, geometry column, attribute columns, filter} under an unguessable id so tile URLs
stay short and cacheable and clients cannot vary the query per tile. The catalogue snapshot is taken at creation, so a
tile request does no catalogue queries.
"""
from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from psycopg import AsyncConnection, sql

from ..config import Settings
from ..errors import ApiError, not_found, validation_error
from .discovery import GeomColumn, TableInfo, pick_geometry
from .filters import compile_filter
from .query_builder import GEO, NUMERIC, Q, attribute_columns, effective_srid, table_ref

LAYER = "layer"
EXTENT = 4096
BUFFER = 64
MAX_ATTR_DEFAULT = 50
WORLD = [-180.0, -85.0511, 180.0, 85.0511]
INT_TYPES = {"int2", "int4", "int8"}
MVT_NATIVE = {"bool", "int2", "int4", "int8", "float4", "float8", "text", "varchar", "bpchar", "name"}


@dataclass
class TileSession:
    id: str
    owner: str
    connection_id: str
    info: TableInfo
    geom: GeomColumn
    attrs: list[dict]
    filter_raw: Any
    assumed_srid: int | None
    minzoom: int
    maxzoom: int
    bounds: list[float]
    created: float = field(default_factory=time.time)
    expires: float = 0.0
    fid: str | None = None

    @property
    def fields(self) -> dict[str, str]:
        return {c["name"]: ("Number" if c["udt"] in NUMERIC else "Boolean" if c["udt"] == "bool" else "String") for c in self.attrs}


class SessionRegistry:
    def __init__(self, settings: Settings):
        self.s = settings
        self._sessions: dict[str, TileSession] = {}

    def _sweep(self) -> None:
        now = time.time()
        for k in [k for k, v in self._sessions.items() if v.expires < now]:
            del self._sessions[k]

    def create(self, **kw: Any) -> TileSession:
        self._sweep()
        owner = kw["owner"]
        if len(self._sessions) >= self.s.tile_max_sessions:
            raise ApiError(429, "rate_limited", "Too many tile sessions; delete unused ones.", headers={"Retry-After": "60"})
        if sum(1 for v in self._sessions.values() if v.owner == owner) >= max(10, self.s.tile_max_sessions // 4):
            raise ApiError(429, "rate_limited", "Too many tile sessions for this user; delete unused ones.", headers={"Retry-After": "60"})
        sess = TileSession(id=secrets.token_urlsafe(24), expires=time.time() + self.s.tile_session_ttl_s, **kw)
        self._sessions[sess.id] = sess
        return sess

    def get(self, sid: str, user_sub: str, role: str) -> TileSession:
        self._sweep()
        s = self._sessions.get(sid)
        if s is None or (s.owner != user_sub and role != "admin"):  # same answer for "missing" and "not yours"
            raise not_found("Tile session not found or expired.")
        return s

    def delete(self, sid: str, user_sub: str, role: str) -> None:
        self.get(sid, user_sub, role)
        del self._sessions[sid]

    def __len__(self) -> int:
        return len(self._sessions)


# --- query -------------------------------------------------------------------------

def _prop(c: dict) -> sql.Composable:
    name = sql.Identifier(c["name"])
    udt = c["udt"]
    if udt in MVT_NATIVE:
        return sql.SQL("{n} AS {n}").format(n=name)
    if udt == "numeric":
        return sql.SQL("{n}::float8 AS {n}").format(n=name)
    return sql.SQL("{n}::text AS {n}").format(n=name)


def simplify_tolerance(z: int) -> float:
    """One MVT grid unit (1/4096 of a tile) in Web Mercator metres."""
    return 40075016.6856 / (2 ** z) / EXTENT


def tile_query(sess: TileSession, settings: Settings, z: int, x: int, y: int) -> tuple[sql.Composable, list[Any]]:
    g = sess.geom
    srid = effective_srid(g, sess.assumed_srid)
    q = Q()
    env = sql.SQL("ST_TileEnvelope({}, {}, {}, margin => {})").format(
        sql.Literal(z), sql.Literal(x), sql.Literal(y), sql.Literal(BUFFER / EXTENT))
    tile_env = sql.SQL("ST_TileEnvelope({}, {}, {})").format(sql.Literal(z), sql.Literal(x), sql.Literal(y))
    col = sql.Identifier(g.name)
    # the envelope is transformed to the column SRID; the indexed column is never wrapped in a function
    if g.storage == "geography":
        pred = sql.SQL("ST_Intersects({}, ST_Transform({}, 4326)::geography)").format(col, env)
        geom3857 = sql.SQL("ST_Transform({}::geometry, 3857)").format(col)
    else:
        base = sql.SQL("ST_SetSRID({}, {})").format(col, sql.Literal(srid)) if g.srid == 0 else col
        e = env if srid == 3857 else sql.SQL("ST_Transform({}, {})").format(env, sql.Literal(srid))
        if g.srid == 0:
            e = sql.SQL("ST_SetSRID({}, 0)").format(e)
        pred = sql.SQL("{} && {}").format(col, e)
        geom3857 = base if srid == 3857 else sql.SQL("ST_Transform({}, 3857)").format(base)
    if not g.type.lower().endswith("point"):
        geom3857 = sql.SQL("ST_Simplify({}, {}, true)").format(geom3857, sql.Literal(simplify_tolerance(z) if z < 22 else 0.0))
    select = [_prop(c) for c in sess.attrs]
    if sess.fid and sess.fid not in {c["name"] for c in sess.attrs}:
        select.append(sql.Identifier(sess.fid))
    select.append(sql.SQL("ST_AsMVTGeom({}, {}, {}, {}, true) AS geom").format(geom3857, tile_env, sql.Literal(EXTENT), sql.Literal(BUFFER)))
    where = [pred]
    f = compile_filter(sess.info, settings, q, sess.filter_raw, g, sess.assumed_srid)
    if f is not None:
        where.append(f)
    cap = settings.tile_feature_cap
    args = [sql.Literal(LAYER), sql.Literal(EXTENT), sql.Literal("geom")] + ([sql.Literal(sess.fid)] if sess.fid else [])
    query = sql.SQL("WITH mvtgeom AS (SELECT {sel} FROM {tbl} WHERE {w} LIMIT {cap}) "
                    "SELECT (SELECT ST_AsMVT(m.*, {args}) FROM (SELECT * FROM mvtgeom WHERE geom IS NOT NULL) m) AS tile, "
                    "(SELECT count(*) FROM mvtgeom) AS n").format(
        sel=sql.SQL(", ").join(select), tbl=table_ref(sess.info), w=sql.SQL(" AND ").join(where), cap=sql.Literal(cap),
        args=sql.SQL(", ").join(args))
    return query, q.params


async def render_tile(conn: AsyncConnection, settings: Settings, sess: TileSession, z: int, x: int, y: int) -> tuple[bytes, bool]:
    """Return (mvt bytes, capped). Empty bytes mean an empty tile."""
    query, params = tile_query(sess, settings, z, x, y)
    row = await (await conn.execute(query, params)).fetchone()
    tile = bytes(row["tile"]) if row["tile"] else b""
    return tile, row["n"] >= settings.tile_feature_cap


def etag_for(sess: TileSession, tile: bytes) -> str:
    return '"' + hashlib.sha1(tile).hexdigest()[:20] + '"'


async def create_session(conn: AsyncConnection, settings: Settings, registry: SessionRegistry, info: TableInfo, *, owner: str,
                         connection_id: str, geometry_column: str | None, columns: list[str] | None, filter_raw: Any,
                         minzoom: int, maxzoom: int, assumed_srid: int | None) -> TileSession:
    from .profile import extent as profile_extent

    if minzoom > maxzoom:
        raise validation_error("minzoom must be <= maxzoom.")
    g = pick_geometry(info, geometry_column)
    effective_srid(g, assumed_srid)
    if columns is None:
        attrs = attribute_columns(info, None)[:MAX_ATTR_DEFAULT]
    else:
        attrs = attribute_columns(info, columns)
    compile_filter(info, settings, Q(), filter_raw, g, assumed_srid)  # validate the filter once, up front
    pk = info.primary_key[0] if len(info.primary_key) == 1 else None
    pk_col = next((c for c in info.columns if c["name"] == pk), None) if pk else None
    fid = pk if pk_col and pk_col["udt"] in INT_TYPES else None
    ext, _ = await profile_extent(conn, info, g, info.est_rows, assumed_srid)
    return registry.create(owner=owner, connection_id=connection_id, info=info, geom=g, attrs=attrs, filter_raw=filter_raw,
                           assumed_srid=assumed_srid, minzoom=minzoom, maxzoom=maxzoom,
                           bounds=ext["bbox"] if ext else list(WORLD), fid=fid)
