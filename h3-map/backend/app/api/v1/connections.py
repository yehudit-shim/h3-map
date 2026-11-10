import asyncio
from dataclasses import replace
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from ...auth.deps import admin, editor, viewer
from ...auth.jwt import User
from ...config import Settings, get_settings
from ...errors import ApiError
from ...services.connections import PoolManager, check_host
from .system import get_pools

router = APIRouter(prefix="/connections", tags=["connections"])
SSL = Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]


class ConnectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    host: str = Field(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9._:-]+$")
    port: int = Field(5432, ge=1, le=65535)
    database: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(max_length=256)  # write-only: never part of any response
    sslmode: SSL = "require"
    maxPoolSize: int | None = Field(None, ge=1, le=50)
    statementTimeoutMs: int | None = Field(None, ge=100, le=600_000)


class ConnectionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=100)
    host: str | None = Field(None, min_length=1, max_length=255, pattern=r"^[A-Za-z0-9._:-]+$")
    port: int | None = Field(None, ge=1, le=65535)
    database: str | None = Field(None, min_length=1, max_length=128)
    username: str | None = Field(None, min_length=1, max_length=128)
    password: SecretStr | None = Field(None, max_length=256)
    sslmode: SSL | None = None
    maxPoolSize: int | None = Field(None, ge=1, le=50)
    statementTimeoutMs: int | None = Field(None, ge=100, le=600_000)


class GrantsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subjects: list[str] = Field(max_length=200)  # token `sub` values; empty list = open to every authenticated user


def _store(pools: PoolManager):
    if pools.store is None:
        raise ApiError(501, "not_implemented",
                       "User-defined connections are disabled (set H3MAP_APP_DATABASE_URL and H3MAP_ENCRYPTION_KEY).")
    return pools.store


def _user_conn(pools: PoolManager, cid: str):
    d = pools.get_def(cid)
    if d.source != "user":
        raise ApiError(409, "conflict", "Connections defined in the server configuration are read-only.")
    return d


@router.get("")
async def list_connections(user: User = Depends(viewer), pools: PoolManager = Depends(get_pools)) -> list[dict]:
    out = []
    for d in list(pools.defs.values()):
        if await pools.can_access(d.id, user):
            out.append(d.public(pools.status(d.id)))
    return out


@router.post("", status_code=201)
async def create_connection(body: ConnectionCreate, user: User = Depends(admin), pools: PoolManager = Depends(get_pools),
                            settings: Settings = Depends(get_settings)) -> dict:
    store = _store(pools)
    await asyncio.to_thread(check_host, body.host, settings)  # SSRF guard before anything is stored
    d = await store.create({"name": body.name, "host": body.host, "port": body.port, "database": body.database,
                            "username": body.username, "sslmode": body.sslmode, "max_pool_size": body.maxPoolSize or 5,
                            "statement_timeout_ms": body.statementTimeoutMs or 30000}, body.password.get_secret_value())
    pools.add_def(d)
    return d.public()


@router.get("/{connection_id}")
async def get_connection(connection_id: str, user: User = Depends(viewer), pools: PoolManager = Depends(get_pools)) -> dict:
    await pools.resolve(connection_id)
    d = pools.get_def(connection_id)
    return d.public(pools.status(d.id))


@router.patch("/{connection_id}")
async def patch_connection(connection_id: str, body: ConnectionPatch, user: User = Depends(admin),
                           pools: PoolManager = Depends(get_pools), settings: Settings = Depends(get_settings)) -> dict:
    store = _store(pools)
    await pools.resolve(connection_id)
    _user_conn(pools, connection_id)
    fields = {"name": body.name, "host": body.host, "port": body.port, "database": body.database, "username": body.username,
              "sslmode": body.sslmode, "max_pool_size": body.maxPoolSize, "statement_timeout_ms": body.statementTimeoutMs}
    fields = {k: v for k, v in fields.items() if v is not None}
    if "host" in fields:
        await asyncio.to_thread(check_host, fields["host"], settings)
    d = await store.update(connection_id, fields, body.password.get_secret_value() if body.password else None)
    await pools.remove_def(connection_id)  # drop the pool: it is rebuilt with the new settings on next use
    pools.add_def(d)
    return d.public()


@router.delete("/{connection_id}", status_code=204)
async def delete_connection(connection_id: str, user: User = Depends(admin), pools: PoolManager = Depends(get_pools)) -> Response:
    store = _store(pools)
    await pools.resolve(connection_id)
    _user_conn(pools, connection_id)
    await store.delete(connection_id)
    await pools.remove_def(connection_id)
    return Response(status_code=204)


@router.get("/{connection_id}/grants")
async def get_grants(connection_id: str, user: User = Depends(admin), pools: PoolManager = Depends(get_pools)) -> dict:
    await pools.resolve(connection_id)
    d = pools.get_def(connection_id)
    subjects = list(d.allowed_users) if d.source == "env" else await _store(pools).grants(connection_id)
    return {"connectionId": d.id, "subjects": subjects, "restricted": bool(subjects), "editable": d.source == "user"}


@router.put("/{connection_id}/grants")
async def put_grants(connection_id: str, body: GrantsBody, user: User = Depends(admin), pools: PoolManager = Depends(get_pools)) -> dict:
    store = _store(pools)
    await pools.resolve(connection_id)
    _user_conn(pools, connection_id)
    subjects = await store.set_grants(connection_id, [s.strip() for s in body.subjects if s.strip()])
    return {"connectionId": connection_id, "subjects": subjects, "restricted": bool(subjects), "editable": True}


@router.post("/{connection_id}/test")
async def test_connection(connection_id: str, user: User = Depends(editor), pools: PoolManager = Depends(get_pools)) -> dict:
    await pools.resolve(connection_id)
    return await pools.test(connection_id)
