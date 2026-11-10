from typing import Any

from fastapi import APIRouter, Depends, Path, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ...auth.deps import viewer
from ...auth.jwt import User
from ...config import Settings, get_settings
from ...errors import ApiError, not_found
from ...services import discovery, tiles
from ...services.cancel import cancel_on_disconnect
from ...services.connections import PoolManager
from .system import get_pools

router = APIRouter(tags=["tiles"])
MVT = "application/vnd.mapbox-vector-tile"


def get_sessions(request: Request) -> tiles.SessionRegistry:
    reg = getattr(request.app.state, "tile_sessions", None)
    if reg is None:
        reg = request.app.state.tile_sessions = tiles.SessionRegistry(request.app.state.settings)
    return reg


class SessionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_: str = Field(alias="schema", min_length=1, max_length=128)
    table: str = Field(min_length=1, max_length=128)
    geometryColumn: str | None = Field(None, max_length=128)
    columns: list[str] | None = Field(None, max_length=200)
    filter: dict[str, Any] | None = None
    minzoom: int = Field(0, ge=0, le=24)
    maxzoom: int = Field(22, ge=0, le=24)
    assumedSrid: int | None = Field(None, ge=1, le=998999)


def _url(sid: str) -> str:
    return f"/api/v1/tiles/{sid}/{{z}}/{{x}}/{{y}}.mvt"


@router.post("/connections/{connection_id}/tiles/sessions", status_code=201)
async def create_session(connection_id: str, body: SessionBody, user: User = Depends(viewer),
                         pools: PoolManager = Depends(get_pools), reg: tiles.SessionRegistry = Depends(get_sessions),
                         settings: Settings = Depends(get_settings)) -> dict:
    async with pools.connection(connection_id) as conn:
        info = await discovery.get_table(conn, body.schema_, body.table)
        s = await tiles.create_session(conn, settings, reg, info, owner=user.sub, connection_id=connection_id,
                                       geometry_column=body.geometryColumn, columns=body.columns, filter_raw=body.filter,
                                       minzoom=body.minzoom, maxzoom=body.maxzoom, assumed_srid=body.assumedSrid)
    return {"sessionId": s.id, "urlTemplate": _url(s.id), "bounds": s.bounds, "minzoom": s.minzoom, "maxzoom": s.maxzoom,
            "layer": tiles.LAYER, "fields": s.fields, "expiresAt": int(s.expires)}


@router.get("/tiles/{session_id}/tilejson")
async def tilejson(session_id: str = Path(max_length=64), user: User = Depends(viewer),
                   reg: tiles.SessionRegistry = Depends(get_sessions)) -> dict:
    s = reg.get(session_id, user.sub, user.role)
    return {"tilejson": "3.0.0", "tiles": [_url(s.id)], "minzoom": s.minzoom, "maxzoom": s.maxzoom, "bounds": s.bounds,
            "vector_layers": [{"id": tiles.LAYER, "fields": s.fields}]}


@router.get("/tiles/{session_id}/{z}/{x}/{y}.mvt")
async def get_tile(request: Request, session_id: str = Path(max_length=64), z: int = Path(ge=0, le=24), x: int = Path(ge=0),
                   y: int = Path(ge=0), user: User = Depends(viewer), pools: PoolManager = Depends(get_pools),
                   reg: tiles.SessionRegistry = Depends(get_sessions), settings: Settings = Depends(get_settings)) -> Response:
    s = reg.get(session_id, user.sub, user.role)
    if x >= 2 ** z or y >= 2 ** z:
        raise not_found("Tile coordinates out of range.")
    cache = {"Cache-Control": f"private, max-age={settings.tile_cache_max_age_s}"}
    if z < s.minzoom or z > s.maxzoom:
        return Response(status_code=204, headers=cache)
    async with pools.connection(s.connection_id) as conn:
        async with cancel_on_disconnect(request, conn):
            data, capped = await tiles.render_tile(conn, settings, s, z, x, y)
    if not data:
        return Response(status_code=204, headers=cache)
    tag = tiles.etag_for(s, data)
    headers = {**cache, "ETag": tag, "X-Tile-Capped": "true" if capped else "false"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=MVT, headers=headers)


@router.delete("/tiles/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str = Path(max_length=64), user: User = Depends(viewer),
                         reg: tiles.SessionRegistry = Depends(get_sessions)) -> Response:
    reg.delete(session_id, user.sub, user.role)
    return Response(status_code=204)
