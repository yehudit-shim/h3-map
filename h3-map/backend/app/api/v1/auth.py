import asyncio
import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from ...auth import pg_auth
from ...auth.jwt import check_credentials, create_token
from ...auth.ldap_auth import LdapUnavailable, authenticate as ldap_authenticate
from ...config import Settings, get_settings
from ...errors import ApiError

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("h3map.auth")


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


@router.post("/login")
async def login(body: LoginBody, request: Request, s: Settings = Depends(get_settings)) -> dict:
    # Users live in the database (app.users). An env admin (H3MAP_ADMIN_PASSWORD[_HASH]) is an optional recovery login:
    # when configured it is only ever checked locally, so neither the user database nor LDAP can affect or impersonate it.
    user = None
    env_admin = s.admin_password is not None or bool(s.admin_password_hash)  # optional recovery login, off by default
    if env_admin and body.username.strip().lower() == s.admin_username.lower():
        user = check_credentials(s, body.username, body.password)
    else:
        store = request.app.state.user_store
        try:
            if store is not None:  # accounts created by an admin (app.users)
                user = await store.authenticate(body.username, body.password)
            if user is None:  # a PostgreSQL role: PostgreSQL itself checks the password
                user = await pg_auth.authenticate(s, body.username, body.password)
        except ApiError:
            if not s.ldap_enabled:
                raise ApiError(503, "auth_unavailable", "The database is not reachable. Try again later.")
            log.error("database sign-in unavailable, falling back to LDAP")
        if user is None and s.ldap_enabled:  # off by default
            try:
                user = await asyncio.to_thread(ldap_authenticate, s, body.username, body.password)
            except LdapUnavailable as exc:
                log.error("ldap login unavailable: %s", exc)
                raise ApiError(503, "auth_unavailable", "The sign-in directory is not reachable. Try again later.")
    if user is None:
        raise ApiError(401, "unauthenticated", "Invalid username or password.")
    return {"accessToken": create_token(s, user), "tokenType": "bearer", "expiresIn": s.jwt_ttl_minutes * 60,
            "role": user.role}
