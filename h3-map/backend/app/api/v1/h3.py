from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ...config import Settings, get_settings
from ...services import discovery, h3_service
from ...services.cancel import cancel_on_disconnect
from ...services.connections import PoolManager
from ...services.filters import parse_filter_param
from .system import get_pools

router = APIRouter(tags=["h3"])
T = "/connections/{connection_id}/tables/{schema}/{table}/h3"
Agg = Literal["count", "sum", "avg", "min", "max", "median"]


@router.get(f"{T}/cells")
async def h3_cells(request: Request, connection_id: str, schema: str, table: str,
                   column: str | None = Query(None, max_length=128), resolution: int | None = Query(None, ge=0, le=15),
                   bbox: str | None = Query(None, max_length=200), value: str | None = Query(None, max_length=128),
                   agg: Agg = "count", filter: str | None = Query(None, max_length=16000),
                   maxCells: int | None = Query(None, ge=1, le=2_000_000),
                   pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        async with cancel_on_disconnect(request, conn):
            return await h3_service.h3_cells(conn, settings, info, column=column, resolution=resolution, bbox=bbox, value=value,
                                             agg=agg, filter_raw=parse_filter_param(filter), max_cells=maxCells)


@router.get(f"{T}/aggregate")
async def h3_aggregate(request: Request, connection_id: str, schema: str, table: str,
                       resolution: int = Query(8, ge=0, le=15), geometryColumn: str | None = Query(None, max_length=128),
                       bbox: str | None = Query(None, max_length=200), value: str | None = Query(None, max_length=128),
                       agg: Agg = "count", weight: str | None = Query(None, max_length=128),
                       filter: str | None = Query(None, max_length=16000), maxCells: int | None = Query(None, ge=1, le=2_000_000),
                       assumedSrid: int | None = Query(None, ge=1, le=998999),
                       pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
    use_sql = settings.h3_sql == "auto" and await pools.has_h3(connection_id)
    async with pools.connection(connection_id) as conn:
        async with cancel_on_disconnect(request, conn):
            return await h3_service.h3_aggregate(conn, settings, info, use_sql=use_sql, geometry_column=geometryColumn,
                                                 resolution=resolution, bbox=bbox, value=value, agg=agg, weight=weight,
                                                 filter_raw=parse_filter_param(filter), max_cells=maxCells, assumed_srid=assumedSrid)


@router.get(f"{T}/resolutions")
async def h3_resolutions(connection_id: str, schema: str, table: str, column: str | None = Query(None, max_length=128),
                         pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        return await h3_service.h3_resolutions(conn, settings, info, column)


class PolyfillBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    geometry: dict
    resolution: int = Field(ge=0, le=15)
    mode: Literal["center", "full", "overlap"] = "center"


class CellsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cells: list[StrictStr] = Field(min_length=1, max_length=1000)


class ChildrenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cell: StrictStr
    resolution: int = Field(ge=1, le=15)


@router.post("/h3/polyfill")
async def polyfill(body: PolyfillBody, settings: Settings = Depends(get_settings)) -> dict:
    return h3_service.polyfill(settings, body.geometry, body.resolution, body.mode)


@router.post("/h3/cells/info")
async def cells_info(body: CellsBody) -> list[dict]:
    return [h3_service.cell_info(c) for c in body.cells]


@router.post("/h3/cells/children")
async def cells_children(body: ChildrenBody) -> dict:
    return h3_service.children(body.cell, body.resolution)
