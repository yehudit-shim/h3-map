"""JSON filter grammar (DATABASE_INTEGRATION section 4). Whitelist only; no SQL text is ever accepted.

    {"op":"and","args":[{"column":"zone","op":"in","value":["R1","R2"]}, {"op":"or","args":[...]}]}
"""
from __future__ import annotations

import json
import math
from typing import Any

from psycopg import sql

from ..config import Settings
from ..errors import ApiError, invalid_filter
from .discovery import GeomColumn, TableInfo
from .query_builder import GEO, NUMERIC, TEXTUAL, Q, bbox_predicate, col_info, effective_srid, parse_bbox

SCALAR_OPS = {"eq": "=", "neq": "<>", "lt": "<", "lte": "<=", "gt": ">", "gte": ">="}
GROUP_OPS = {"and", "or", "not"}
SPATIAL_OPS = {"intersects", "within_distance", "bbox"}
ALL_OPS = set(SCALAR_OPS) | {"between", "in", "not_in", "like", "ilike", "is_null", "not_null"} | GROUP_OPS | SPATIAL_OPS
GEOJSON_TYPES = {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}
MAX_IN = 1000
MAX_STR = 500
MAX_GEOJSON_BYTES = 1_000_000


def validate_geojson(geom: Any, max_vertices: int) -> str:
    """Validate an input geometry (type whitelist, finite in-range coordinates, vertex cap, size cap, ST_IsValid)
    and return it as compact JSON text."""
    if not isinstance(geom, dict) or geom.get("type") not in GEOJSON_TYPES or "coordinates" not in geom:
        raise invalid_filter("Geometry must be a GeoJSON " + "/".join(sorted(GEOJSON_TYPES)))
    count = 0

    def walk(c: Any, depth: int) -> None:
        nonlocal count
        if depth > 5:
            raise invalid_filter("Geometry nesting is too deep.")
        if isinstance(c, (list, tuple)) and c and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in c):
            if len(c) < 2 or len(c) > 3 or not all(math.isfinite(x) for x in c):
                raise invalid_filter("Invalid coordinate.")
            if not (-180 <= c[0] <= 180 and -90 <= c[1] <= 90):
                raise invalid_filter("Coordinate out of range (EPSG:4326 lon/lat).")
            count += 1
            if count > max_vertices:
                raise ApiError(413, "payload_too_large", "Geometry has too many vertices.", {"max": max_vertices})
        elif isinstance(c, (list, tuple)):
            for x in c:
                walk(x, depth + 1)
        else:
            raise invalid_filter("Invalid coordinates.")

    walk(geom["coordinates"], 0)
    text = json.dumps({"type": geom["type"], "coordinates": geom["coordinates"]}, separators=(",", ":"))
    if len(text) > MAX_GEOJSON_BYTES:
        raise ApiError(413, "payload_too_large", "Geometry is too large.")
    try:
        from shapely.geometry import shape
        if not shape(json.loads(text)).is_valid:
            raise invalid_filter("Geometry is not valid (self-intersection or unclosed ring).")
    except ApiError:
        raise
    except Exception:
        raise invalid_filter("Geometry could not be parsed.")
    return text


class FilterCompiler:
    def __init__(self, info: TableInfo, settings: Settings, q: Q, default_geom: GeomColumn | None, assumed: int | None):
        self.info, self.s, self.q, self.default_geom, self.assumed = info, settings, q, default_geom, assumed
        self.nodes = 0

    # -- entry --------------------------------------------------------------
    def compile(self, node: Any, depth: int = 1) -> sql.Composable:
        self.nodes += 1
        if self.nodes > self.s.max_filter_nodes:
            raise invalid_filter("Filter has too many nodes.", max=self.s.max_filter_nodes)
        if depth > self.s.max_filter_depth:
            raise invalid_filter("Filter is nested too deeply.", max=self.s.max_filter_depth)
        if not isinstance(node, dict):
            raise invalid_filter("A filter node must be an object.")
        op = node.get("op")
        if op not in ALL_OPS:
            raise invalid_filter(f"Unknown operator '{str(op)[:32]}'", operators=sorted(ALL_OPS))
        if op in GROUP_OPS:
            return self._group(node, op, depth)
        if op in SPATIAL_OPS:
            return self._spatial(node, op)
        return self._condition(node, op)

    # -- groups -------------------------------------------------------------
    def _group(self, node: dict, op: str, depth: int) -> sql.Composable:
        self._keys(node, {"op", "args"})
        args = node.get("args")
        if not isinstance(args, list) or not args or len(args) > self.s.max_filter_nodes:
            raise invalid_filter("'args' must be a non-empty list.")
        if op == "not":
            if len(args) != 1:
                raise invalid_filter("'not' takes exactly one argument.")
            return sql.SQL("NOT ({})").format(self.compile(args[0], depth + 1))
        parts = [self.compile(a, depth + 1) for a in args]
        return sql.SQL("({})").format(sql.SQL(" AND " if op == "and" else " OR ").join(parts))

    # -- column conditions --------------------------------------------------
    @staticmethod
    def _keys(node: dict, allowed: set[str]) -> None:
        extra = set(node) - allowed
        if extra:
            raise invalid_filter("Unknown filter keys.", keys=sorted(map(str, extra))[:5])

    def _condition(self, node: dict, op: str) -> sql.Composable:
        self._keys(node, {"op", "column", "value"})
        c = col_info(self.info, node.get("column"))
        udt = c["udt"]
        if udt in GEO:
            raise invalid_filter("Use a spatial operator for geometry columns.", column=c["name"])
        col = sql.Identifier(c["name"])
        if op == "is_null":
            return sql.SQL("{} IS NULL").format(col)
        if op == "not_null":
            return sql.SQL("{} IS NOT NULL").format(col)
        if "value" not in node:
            raise invalid_filter("Missing 'value'.", column=c["name"])
        v = node["value"]
        if op in SCALAR_OPS:
            return sql.SQL("{} {} {}").format(col, sql.SQL(SCALAR_OPS[op]), self.q.add(self._scalar(v, udt, c["name"])))
        if op == "between":
            if not isinstance(v, list) or len(v) != 2:
                raise invalid_filter("'between' needs [low, high].", column=c["name"])
            lo, hi = (self._scalar(x, udt, c["name"]) for x in v)
            return sql.SQL("{} BETWEEN {} AND {}").format(col, self.q.add(lo), self.q.add(hi))
        if op in ("in", "not_in"):
            if not isinstance(v, list) or not v or len(v) > MAX_IN:
                raise invalid_filter(f"'{op}' needs a list of 1..{MAX_IN} values.", column=c["name"])
            vals = [self._scalar(x, udt, c["name"]) for x in v]
            if udt in NUMERIC or udt in TEXTUAL or udt == "bool":
                test = sql.SQL("{} = ANY({})").format(col, self.q.add(vals))
            else:  # dates, uuids, ...: compare as text
                test = sql.SQL("{}::text = ANY({})").format(col, self.q.add([str(x) for x in vals]))
            return test if op == "in" else sql.SQL("NOT ({})").format(test)
        if op in ("like", "ilike"):
            if not isinstance(v, str) or len(v) > MAX_STR:
                raise invalid_filter(f"'{op}' needs a string pattern.", column=c["name"])
            target = col if udt in TEXTUAL else sql.SQL("{}::text").format(col)
            return sql.SQL("{} {} {}").format(target, sql.SQL("LIKE" if op == "like" else "ILIKE"), self.q.add(v))
        raise invalid_filter("Unsupported operator.")  # pragma: no cover

    @staticmethod
    def _scalar(v: Any, udt: str, name: str) -> Any:
        if v is None or isinstance(v, (list, dict)):
            raise invalid_filter("Expected a scalar value.", column=name)
        if udt in NUMERIC:
            if isinstance(v, bool):
                raise invalid_filter("Expected a number.", column=name)
            if isinstance(v, int):
                return v
            if isinstance(v, str) and v.strip().lstrip("-").isdigit() and len(v.strip()) < 19:
                return int(v)
            try:
                f = float(v)
            except (TypeError, ValueError):
                raise invalid_filter("Expected a number.", column=name)
            if not math.isfinite(f):
                raise invalid_filter("Expected a finite number.", column=name)
            return int(f) if udt.startswith("int") and f == int(f) and abs(f) < 2**53 else f
        if udt == "bool":
            if isinstance(v, bool):
                return v
            raise invalid_filter("Expected true or false.", column=name)
        if isinstance(v, bool) or not isinstance(v, (str, int, float)):
            raise invalid_filter("Expected a string value.", column=name)
        s = str(v)
        if len(s) > MAX_STR:
            raise invalid_filter("Value too long.", column=name)
        return s

    # -- spatial -------------------------------------------------------------
    def _geom(self, node: dict) -> GeomColumn:
        name = node.get("column")
        gs = self.info.geometry
        if not gs:
            raise invalid_filter("The table has no geometry column.")
        if name is None:
            return self.default_geom or gs[0]
        for g in gs:
            if g.name == name:
                return g
        raise invalid_filter("Unknown geometry column.", column=str(name)[:64])

    def _spatial(self, node: dict, op: str) -> sql.Composable:
        g = self._geom(node)
        col = sql.Identifier(g.name)
        srid = effective_srid(g, self.assumed)
        if op == "bbox":
            self._keys(node, {"op", "column", "bbox"})
            return bbox_predicate(self.q, g, parse_bbox_filter(node.get("bbox")), self.assumed)
        if op == "intersects":
            self._keys(node, {"op", "column", "geometry"})
            text = validate_geojson(node.get("geometry"), self.s.max_geometry_vertices)
            base = sql.SQL("ST_SetSRID(ST_GeomFromGeoJSON({}), 4326)").format(self.q.add(text))
            if g.storage == "geography":
                return sql.SQL("ST_Intersects({}, {}::geography)").format(col, base)
            t = base if srid == 4326 else sql.SQL("ST_Transform({}, {})").format(base, sql.Literal(srid))
            if g.srid == 0:
                t = sql.SQL("ST_SetSRID({}, 0)").format(t)
            return sql.SQL("ST_Intersects({}, {})").format(col, t)
        # within_distance: point [lon, lat], distance in metres
        self._keys(node, {"op", "column", "point", "distance"})
        p, d = node.get("point"), node.get("distance")
        if (not isinstance(p, list) or len(p) != 2 or not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in p)
                or not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90)):
            raise invalid_filter("'point' must be [lon, lat].")
        if isinstance(d, bool) or not isinstance(d, (int, float)) or not (0 < d <= 1_000_000):
            raise invalid_filter("'distance' must be metres in (0, 1000000].")
        def point() -> sql.Composable:  # a fresh set of placeholders per use, in emission order
            return sql.SQL("ST_SetSRID(ST_MakePoint({}, {}), 4326)").format(self.q.add(float(p[0])), self.q.add(float(p[1])))

        if g.storage == "geography":
            return sql.SQL("ST_DWithin({}, {}::geography, {})").format(col, point(), self.q.add(float(d)))
        # geometry: index-friendly envelope pre-filter, then exact geodesic test
        base = sql.SQL("ST_SetSRID({}, {})").format(col, sql.Literal(srid)) if g.srid == 0 else col
        env = sql.SQL("ST_Envelope(ST_Buffer({}::geography, {})::geometry)").format(point(), self.q.add(float(d)))
        env_t = env if srid == 4326 else sql.SQL("ST_Transform({}, {})").format(env, sql.Literal(srid))
        if g.srid == 0:
            env_t = sql.SQL("ST_SetSRID({}, 0)").format(env_t)
        local = base if srid == 4326 else sql.SQL("ST_Transform({}, 4326)").format(base)
        return sql.SQL("({} && {} AND ST_DWithin({}::geography, {}::geography, {}))").format(
            col, env_t, local, point(), self.q.add(float(d)))


def parse_bbox_filter(v: Any) -> tuple[float, float, float, float]:
    try:
        return parse_bbox(v)
    except ApiError as e:
        raise invalid_filter(e.message)


def compile_filter(info: TableInfo, settings: Settings, q: Q, raw: Any, default_geom: GeomColumn | None = None,
                   assumed: int | None = None) -> sql.Composable | None:
    if raw is None:
        return None
    return FilterCompiler(info, settings, q, default_geom, assumed).compile(raw)


def parse_filter_param(text: str | None) -> Any:
    if text is None or text == "":
        return None
    if len(text) > 16_000:
        raise ApiError(413, "payload_too_large", "Filter is too large.")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise invalid_filter("filter is not valid JSON.")
