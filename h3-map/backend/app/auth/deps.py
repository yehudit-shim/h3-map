"""Authorisation by dependency injection. Every route must depend on ``require_role``."""
from __future__ import annotations

import jwt as pyjwt
from fastapi import Depends, Request

from ..config import Settings, get_settings
from ..errors import ApiError
from .jwt import ROLE_RANK, User, decode_token


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    scheme, _, token = h.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def require_role(min_role: str):
    """Return a dependency that authenticates the bearer token and checks the role."""
    if min_role not in ROLE_RANK:
        raise ValueError(min_role)

    async def dependency(request: Request, settings: Settings = Depends(get_settings)) -> User:
        token = _bearer(request)
        if token is None:
            raise ApiError(401, "unauthenticated", "Missing bearer token.", headers={"WWW-Authenticate": "Bearer"})
        try:
            user = decode_token(settings, token)
        except pyjwt.PyJWTError:
            raise ApiError(401, "unauthenticated", "Invalid or expired token.", headers={"WWW-Authenticate": "Bearer"})
        if ROLE_RANK[user.role] < ROLE_RANK[min_role]:
            raise ApiError(403, "forbidden", f"Requires role {min_role}.")
        request.state.user = user
        return user

    dependency.__is_auth_dependency__ = True  # type: ignore[attr-defined]
    dependency.__min_role__ = min_role  # type: ignore[attr-defined]
    return dependency


viewer = require_role("viewer")
editor = require_role("editor")
admin = require_role("admin")
