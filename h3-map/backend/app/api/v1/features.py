from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ...config import Settings, get_settings
from ...errors import bad_request
from ...services import discovery, features
from ...services.cancel import cancel_on_disconnect
from ...services.connections import PoolManager
from ...services.filters import parse_filter_param
from .system import get_pools

router = APIRouter(prefix="/connections/{connection_id}/tables/{schema}/{table}", tags=["features"])
GEOJSON = "application/geo+json"


class FeatureQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    geometryColumn: str | None = Field(None, max_length=128)
    bbox: list[float] | None = Field(None, min_length=4, max_length=4)
    columns: list[str] | None = Field(None, max_length=200)
    filter: dict[str, Any] | None = None
    spatial: dict[str, Any] | None = None
    simplify: float | Literal["auto"] | None = Field(None, ge=0, le=10)
    zoom: float | None = Field(None, ge=0, le=24)
    limit: int | None = Field(None, ge=1, le=1_000_000)
    after: str | int | None = None
    paginate: bool = False
    assumedSrid: int | None = Field(None, ge=1, le=998999)
    format: Literal["geojson", "arrow"] = "geojson"


def _cols(columns: str | None) -> list[str] | None:
    if columns is None:
        return None
    out = [c for c in columns.split(",") if c]
    if len(out) > 200:
        raise bad_request("Too many columns.")
    return out


ARROW = "application/vnd.apache.arrow.stream"


async def _run(request: Request, pools: PoolManager, settings: Settings, cid: str, schema: str, table: str,
               fmt: str = "geojson", **kw) -> Response:
    async with pools.connection(cid) as conn:
        info = await discovery.get_table(conn, schema, table)
        async with cancel_on_disconnect(request, conn):
            result = await features.query_features(conn, settings, info, binary=fmt == "arrow", **kw)
    headers = {"X-Truncated": str(result["truncated"]).lower()}
    if fmt == "arrow":
        return Response(features.to_arrow(result), media_type=ARROW, headers=headers)
    return Response(features.to_geojson(result), media_type=GEOJSON, headers=headers)


@router.get("/features")
async def get_features(request: Request, connection_id: str, schema: str, table: str,
                       geometryColumn: str | None = Query(None, max_length=128), bbox: str | None = Query(None, max_length=200),
                       columns: str | None = Query(None, max_length=4000), filter: str | None = Query(None, max_length=16000),
                       simplify: str | None = Query(None, max_length=16), zoom: float | None = Query(None, ge=0, le=24),
                       limit: int | None = Query(None, ge=1, le=1_000_000), after: str | None = Query(None, max_length=200),
                       paginate: bool = False, assumedSrid: int | None = Query(None, ge=1, le=998999),
                       format: Literal["geojson", "arrow"] = "geojson",
                       pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> Response:
    simp: float | str | None = None
    if simplify is not None:
        if simplify == "auto":
            simp = "auto"
        else:
            try:
                simp = float(simplify)
            except ValueError:
                raise bad_request("simplify must be a tolerance in degrees or 'auto'.")
            if not (0 <= simp <= 10):
                raise bad_request("simplify out of range.")
    return await _run(request, pools, settings, connection_id, schema, table, geometry_column=geometryColumn, bbox=bbox,
                      columns=_cols(columns), filter_raw=parse_filter_param(filter), simplify=simp, zoom=zoom, limit=limit,
                      after=after, paginate=paginate, assumed_srid=assumedSrid, fmt=format)


@router.post("/features/query")
async def post_features(request: Request, connection_id: str, schema: str, table: str, body: FeatureQuery,
                        pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> Response:
    return await _run(request, pools, settings, connection_id, schema, table, geometry_column=body.geometryColumn,
                      bbox=body.bbox, columns=body.columns, filter_raw=body.filter, spatial=body.spatial,
                      simplify=body.simplify, zoom=body.zoom, limit=body.limit, after=body.after, paginate=body.paginate,
                      assumed_srid=body.assumedSrid, fmt=body.format)


@router.get("/features/{feature_id}")
async def get_one(connection_id: str, schema: str, table: str, feature_id: str,
                  geometryColumn: str | None = Query(None, max_length=128), columns: str | None = Query(None, max_length=4000),
                  assumedSrid: int | None = Query(None, ge=1, le=998999),
                  pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> Response:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        feat = await features.get_feature(conn, settings, info, feature_id, geometryColumn, _cols(columns), assumedSrid)
    from ...services.query_builder import dumps
    return Response(dumps(feat), media_type=GEOJSON)
