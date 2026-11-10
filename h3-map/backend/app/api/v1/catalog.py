from typing import Literal

from fastapi import APIRouter, Depends, Query

from ...services import discovery
from ...services.connections import PoolManager
from .system import get_pools

router = APIRouter(prefix="/connections/{connection_id}", tags=["catalog"])


@router.get("/databases")
async def list_databases(connection_id: str, pools: PoolManager = Depends(get_pools)) -> list[dict]:
    async with pools.connection(connection_id) as conn:
        return await discovery.databases(conn)


@router.get("/schemas")
async def list_schemas(connection_id: str, pools: PoolManager = Depends(get_pools)) -> list[dict]:
    async with pools.connection(connection_id) as conn:
        return await discovery.schemas(conn)


@router.get("/schemas/{schema}/tables")
async def list_tables(connection_id: str, schema: str, kind: Literal["table", "view", "matview", "partitioned", "foreign"] | None = None,
                      geo: bool | None = None, q: str | None = Query(None, max_length=100),
                      pools: PoolManager = Depends(get_pools)) -> list[dict]:
    async with pools.connection(connection_id) as conn:
        return await discovery.tables(conn, schema, kind, geo, q)


@router.get("/tables/{schema}/{table}/columns")
async def list_columns(connection_id: str, schema: str, table: str, pools: PoolManager = Depends(get_pools)) -> list[dict]:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
    return [{"name": c["name"], "type": c["type"], "nullable": c["nullable"], "isPrimaryKey": c["isPrimaryKey"]}
            for c in info.columns]
