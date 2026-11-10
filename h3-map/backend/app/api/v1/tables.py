from fastapi import APIRouter, Depends, Query

from ...config import Settings, get_settings
from ...services import discovery, profile
from ...services.connections import PoolManager
from .system import get_pools

router = APIRouter(prefix="/connections/{connection_id}/tables/{schema}/{table}", tags=["tables"])


@router.get("/profile")
async def table_profile(connection_id: str, schema: str, table: str, exact: bool = False,
                        assumedSrid: int | None = Query(None, ge=1, le=998999),
                        pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, schema, table)
        return await profile.build_profile(conn, info, settings, exact=exact, assumed_srid=assumedSrid)
