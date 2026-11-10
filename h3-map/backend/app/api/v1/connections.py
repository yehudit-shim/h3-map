from fastapi import APIRouter, Depends

from ...auth.deps import editor, viewer
from ...auth.jwt import User
from ...services.connections import PoolManager
from .system import get_pools

router = APIRouter(prefix="/connections", tags=["connections"])


@router.get("")
async def list_connections(user: User = Depends(viewer), pools: PoolManager = Depends(get_pools)) -> list[dict]:
    return [d.public(pools.status(d.id)) for d in pools.defs.values()]


@router.get("/{connection_id}")
async def get_connection(connection_id: str, user: User = Depends(viewer), pools: PoolManager = Depends(get_pools)) -> dict:
    d = pools.get_def(connection_id)
    return d.public(pools.status(d.id))


@router.post("/{connection_id}/test")
async def test_connection(connection_id: str, user: User = Depends(editor), pools: PoolManager = Depends(get_pools)) -> dict:
    return await pools.test(connection_id)
