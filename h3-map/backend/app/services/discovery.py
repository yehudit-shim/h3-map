"""Catalogue discovery. Only catalogue queries here: no table scans except the bounded
sample used for unconstrained geometry columns. This module is also the place where
identifiers are verified against the live catalogue (``get_table`` / ``require_column``)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from psycopg import AsyncConnection

from ..errors import not_found, validation_error

KIND_NAMES = {"r": "table", "v": "view", "m": "matview", "p": "partitioned", "f": "foreign"}
KIND_CODES = {v: k for k, v in KIND_NAMES.items()}
HIDDEN_SCHEMAS = ("information_schema", "tiger", "tiger_data", "topology")
H3_NAME_RE = re.compile(r"^(h3|h3_?index|hex(id)?|cell(_?id)?|h3_\d{1,2})$", re.I)
GEO_TYPES = ("geometry", "geography")

_SCHEMA_FILTER = r"""n.nspname NOT LIKE 'pg\_%%' AND n.nspname <> ALL(%(hidden)s)
                     AND has_schema_privilege(n.oid, 'USAGE')"""


@dataclass
class GeomColumn:
    name: str
    type: str          # Point, MultiPolygon, ..., Geometry (unconstrained), mixed
    srid: int
    dims: int
    storage: str = "geometry"   # or geography
    constrained: bool = True

    def public(self) -> dict:
        return {"name": self.name, "type": self.type, "srid": self.srid}


@dataclass
class TableInfo:
    schema: str
    name: str
    kind: str
    oid: int
    est_rows: int | None
    comment: str | None
    columns: list[dict] = field(default_factory=list)
    geometry: list[GeomColumn] = field(default_factory=list)
    primary_key: list[str] = field(default_factory=list)


async def databases(conn: AsyncConnection) -> list[dict]:
    cur = await conn.execute("SELECT datname AS name FROM pg_database WHERE NOT datistemplate "
                             "AND has_database_privilege(datname, 'CONNECT') ORDER BY 1")
    return await cur.fetchall()


async def schemas(conn: AsyncConnection) -> list[dict]:
    cur = await conn.execute(
        f"""SELECT n.nspname AS name,
               (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r','v','m','p','f')
                  AND has_table_privilege(c.oid, 'SELECT'))::int AS "tableCount"
            FROM pg_namespace n WHERE {_SCHEMA_FILTER} ORDER BY 1""", {"hidden": list(HIDDEN_SCHEMAS)})
    return await cur.fetchall()


_GEOM_SQL = """
SELECT n.nspname AS schema, c.relname AS "table", a.attname AS col, t.typname AS storage,
       a.atttypmod AS typmod, a.attnum
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
WHERE a.attnum > 0 AND NOT a.attisdropped AND t.typname = ANY(%(types)s)
  AND c.relkind IN ('r','v','m','p','f')
  AND n.nspname = %(schema)s AND (%(table)s::text IS NULL OR c.relname = %(table)s)
  AND has_table_privilege(c.oid, 'SELECT')
ORDER BY c.relname, a.attnum
"""


def _decode_typmod(typmod: int) -> tuple[str, int, int]:
    """PostGIS typmod: srid in bits 8..28 (sign-extended 21 bits), type in bits 2..7, Z bit 0x4, M 0x2."""
    if typmod < 0:
        return "Geometry", 0, 2
    srid = (typmod & 0x0FFFFF00) >> 8
    if srid & 0x00100000:
        srid |= ~0x001FFFFF
    srid = max(srid, 0)
    t = (typmod & 0x000000FC) >> 2
    names = {0: "Geometry", 1: "Point", 2: "LineString", 3: "Polygon", 4: "MultiPoint", 5: "MultiLineString",
             6: "MultiPolygon", 7: "GeometryCollection"}
    z, m = bool(typmod & 2), bool(typmod & 1)
    return names.get(t, "Geometry"), srid, 2 + z + m


async def geometry_columns(conn: AsyncConnection, schema: str, table: str | None = None) -> dict[str, list[GeomColumn]]:
    """Geometry/geography columns per table, for tables, views, matviews, partitioned and foreign tables.

    Typmod gives type and SRID for constrained columns (also through views). Unconstrained columns
    (typmod -1, or type Geometry) are sampled (up to 1000 rows) for their actual types/SRID."""
    cur = await conn.execute(_GEOM_SQL, {"types": list(GEO_TYPES), "schema": schema, "table": table})
    out: dict[str, list[GeomColumn]] = {}
    for r in await cur.fetchall():
        gtype, srid, dims = _decode_typmod(r["typmod"])
        if r["storage"] == "geography" and srid == 0 and r["typmod"] >= 0:
            srid = 4326
        if r["storage"] == "geography" and r["typmod"] < 0:
            srid = 4326
        gc = GeomColumn(r["col"], gtype, srid, dims, r["storage"], constrained=gtype != "Geometry" or srid != 0)
        if r["storage"] == "geometry" and (gtype == "Geometry" or (srid == 0 and r["typmod"] < 0)):
            gc = await _sample_geometry(conn, schema, r["table"], gc)
        out.setdefault(r["table"], []).append(gc)
    return out


async def _sample_geometry(conn: AsyncConnection, schema: str, table: str, gc: GeomColumn) -> GeomColumn:
    from psycopg import sql
    q = sql.SQL("SELECT DISTINCT ST_GeometryType({c}) AS t, ST_SRID({c}) AS s FROM (SELECT {c} FROM {s}.{t} "
                "WHERE {c} IS NOT NULL LIMIT 1000) x").format(c=sql.Identifier(gc.name), s=sql.Identifier(schema),
                                                                 t=sql.Identifier(table))
    try:
        rows = await (await conn.execute(q)).fetchall()
    except Exception:  # unreadable view etc.: keep the declared (unknown) description
        return gc
    types = {r["t"].removeprefix("ST_") for r in rows if r["t"]}
    srids = {r["s"] for r in rows}
    if not rows:
        return gc
    gc.type = types.pop() if len(types) == 1 else "mixed"
    gc.srid = srids.pop() if len(srids) == 1 else gc.srid
    gc.constrained = False
    return gc


async def tables(conn: AsyncConnection, schema: str, kind: str | None = None, geo: bool | None = None,
                 q: str | None = None) -> list[dict]:
    if kind and kind not in KIND_CODES:
        raise validation_error("Unknown kind.", allowed=sorted(KIND_CODES))
    cur = await conn.execute(
        r"""SELECT c.relname AS name, c.relkind, c.reltuples::bigint AS est, obj_description(c.oid, 'pg_class') AS comment,
                   EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
                           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                             AND (t.typname = 'h3index'
                                  OR (a.attname ~* '^(h3|h3_?index|hex(id)?|cell(_?id)?|h3_\d{1,2})$'
                                      AND t.typname IN ('int8','text','varchar')))) AS has_h3
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r','v','m','p','f') AND n.nspname = %(schema)s
              AND has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')
              AND (%(kind)s::text IS NULL OR c.relkind = %(kind)s)
              AND (%(q)s::text IS NULL OR c.relname ILIKE %(q)s ESCAPE '\')
            ORDER BY c.relname""",
        {"schema": schema, "kind": KIND_CODES.get(kind) if kind else None,
         "q": _like(q) if q else None})
    rows = await cur.fetchall()
    geoms = await geometry_columns(conn, schema)
    out = []
    for r in rows:
        gcs = geoms.get(r["name"], [])
        if geo is True and not gcs and not r["has_h3"]:
            continue
        if geo is False and (gcs or r["has_h3"]):
            continue
        out.append({"schema": schema, "name": r["name"], "kind": KIND_NAMES[r["relkind"]],
                    "estimatedRows": r["est"] if r["est"] is not None and r["est"] >= 0 else None,
                    "hasGeometry": bool(gcs), "hasH3": bool(r["has_h3"]),
                    "geometryColumns": [g.public() for g in gcs], "comment": r["comment"]})
    return out


def _like(q: str) -> str:
    return "%" + re.sub(r"([\\%_])", r"\\\1", q) + "%"


async def get_table(conn: AsyncConnection, schema: str, table: str, with_columns: bool = True) -> TableInfo:
    """Verify that ``schema.table`` exists and is selectable by the role; otherwise 404.
    This is the single gate every table-scoped endpoint goes through."""
    cur = await conn.execute(
        """SELECT c.oid::int AS oid, c.relkind, c.reltuples::bigint AS est, obj_description(c.oid, 'pg_class') AS comment
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = %s AND c.relname = %s AND c.relkind IN ('r','v','m','p','f')
             AND has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')""", (schema, table))
    r = await cur.fetchone()
    if r is None:
        raise not_found("Table not found.", schema=schema, table=table)
    info = TableInfo(schema, table, KIND_NAMES[r["relkind"]], r["oid"], r["est"] if r["est"] is not None and r["est"] >= 0 else None,
                     r["comment"])
    if with_columns:
        info.columns = await columns(conn, info.oid)
        info.primary_key = [c["name"] for c in info.columns if c["isPrimaryKey"]]
        info.geometry = (await geometry_columns(conn, schema, table)).get(table, [])
    return info


async def columns(conn: AsyncConnection, oid: int) -> list[dict]:
    cur = await conn.execute(
        """SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, t.typname AS udt,
                  NOT a.attnotnull AS nullable, col_description(a.attrelid, a.attnum) AS comment,
                  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary
                          AND a.attnum = ANY(i.indkey)) AS "isPrimaryKey"
           FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
           WHERE a.attrelid = %s AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum""", (oid,))
    return await cur.fetchall()


def require_column(info: TableInfo, name: str) -> dict:
    for c in info.columns:
        if c["name"] == name:
            return c
    raise validation_error("Unknown column.", column=name)


def pick_geometry(info: TableInfo, name: str | None) -> GeomColumn:
    if not info.geometry:
        raise validation_error("The table has no geometry column.", table=info.name)
    if name is None:
        return info.geometry[0]
    for g in info.geometry:
        if g.name == name:
            return g
    raise validation_error("Unknown geometry column.", column=name)
