from fastapi import APIRouter, Depends, Query, Request

from ...config import Settings, get_settings
from ...services import discovery, profile, stats
from ...services.cancel import cancel_on_disconnect
from ...services.connections import PoolManager
from ...services.filters import parse_filter_param
from .system import get_pools

router = APIRouter(prefix="/connections/{connection_id}/tables/{schema}/{table}", tags=["tables"])


def _cols(columns: str | None) -> list[str] | None:
    return [c for c in columns.split(",") if c][:200] if columns else None


@router.get("/profile")
async def table_profile(connection_id: str, schema: str, table: str, exact: bool = False,
                        assumedSrid: int | None = Query(None, ge=1, le=998999),
                        pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        return await profile.build_profile(conn, info, settings, exact=exact, assumed_srid=assumedSrid)


@router.get("/rows")
async def table_rows(request: Request, connection_id: str, schema: str, table: str,
                     limit: int = Query(100, ge=1, le=10_000), offset: int = Query(0, ge=0, le=stats.MAX_OFFSET),
                     after: str | None = Query(None, max_length=200), sort: str | None = Query(None, max_length=130),
                     columns: str | None = Query(None, max_length=4000), filter: str | None = Query(None, max_length=16000),
                     includeGeometry: bool = False,
                     pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        async with cancel_on_disconnect(request, conn):
            return await stats.rows(conn, settings, info, limit=limit, offset=offset, after=after, sort=sort,
                                    columns=_cols(columns), filter_raw=parse_filter_param(filter), include_geometry=includeGeometry)


@router.get("/stats")
async def table_stats(request: Request, connection_id: str, schema: str, table: str, column: str = Query(max_length=128),
                      bins: int = Query(20, ge=2, le=200), filter: str | None = Query(None, max_length=16000),
                      pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        async with cancel_on_disconnect(request, conn):
            return await stats.column_stats(conn, settings, info, column, bins, parse_filter_param(filter))


@router.get("/extent")
async def table_extent(request: Request, connection_id: str, schema: str, table: str,
                       geometryColumn: str | None = Query(None, max_length=128), filter: str | None = Query(None, max_length=16000),
                       assumedSrid: int | None = Query(None, ge=1, le=998999),
                       pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        async with cancel_on_disconnect(request, conn):
            return await stats.table_extent(conn, settings, info, geometryColumn, parse_filter_param(filter), assumedSrid)
