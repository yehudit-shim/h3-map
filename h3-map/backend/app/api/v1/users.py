"""User administration (admin only). Users live in ``app.users``; see ``services/users.py``."""
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from ...auth.deps import admin
from ...auth.jwt import User
from ...errors import ApiError
from ...services.users import UserStore

router = APIRouter(prefix="/users", tags=["users"])
Role = Literal["viewer", "editor", "admin"]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(min_length=8, max_length=256)  # write-only
    role: Role = "viewer"
    displayName: str | None = Field(None, max_length=128)


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: SecretStr | None = Field(None, min_length=8, max_length=256)
    role: Role | None = None
    displayName: str | None = Field(None, max_length=128)
    active: bool | None = None


def get_user_store(request: Request) -> UserStore:
    store = request.app.state.user_store
    if store is None:
        raise ApiError(501, "not_implemented", "Database users are disabled (set H3MAP_APP_DATABASE_URL).")
    return store


@router.get("")
async def list_users(user: User = Depends(admin), store: UserStore = Depends(get_user_store)) -> list[dict]:
    return await store.list()


@router.post("", status_code=201)
async def create_user(body: UserCreate, user: User = Depends(admin), store: UserStore = Depends(get_user_store)) -> dict:
    return await store.create(body.username, body.password.get_secret_value(), body.role, body.displayName)


@router.patch("/{user_id}")
async def patch_user(user_id: str, body: UserPatch, user: User = Depends(admin), store: UserStore = Depends(get_user_store)) -> dict:
    return await store.update(user_id, body.model_dump(exclude={"password"}), body.password.get_secret_value() if body.password else None)


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, user: User = Depends(admin), store: UserStore = Depends(get_user_store)) -> Response:
    await store.delete(user_id)
    return Response(status_code=204)
