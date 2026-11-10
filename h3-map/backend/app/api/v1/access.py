"""Per-connection access control. Added as a router dependency next to the role check."""
from fastapi import Depends, Request

from ...auth.deps import viewer
from ...auth.jwt import User
from ...errors import ApiError
from ...services.connections import PoolManager


def get_pools(request: Request) -> PoolManager:
    return request.app.state.pools


async def connection_access(request: Request, user: User = Depends(viewer)) -> None:
    """Routes without a ``connection_id`` path parameter pass; others need access to that connection.
    Admins always have access. Unknown ids fall through to the handler's 404."""
    cid = request.path_params.get("connection_id")
    if cid is None:
        return
    pools = get_pools(request)
    if cid in pools.defs and not await pools.can_access(cid, user):
        raise ApiError(403, "forbidden", "You have no access to this connection.")
