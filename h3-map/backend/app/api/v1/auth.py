from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ...auth.jwt import check_credentials, create_token
from ...config import Settings, get_settings
from ...errors import ApiError

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


@router.post("/login")
async def login(body: LoginBody, s: Settings = Depends(get_settings)) -> dict:
    user = check_credentials(s, body.username, body.password)
    if user is None:
        raise ApiError(401, "unauthenticated", "Invalid username or password.")
    return {"accessToken": create_token(s, user), "tokenType": "bearer", "expiresIn": s.jwt_ttl_minutes * 60,
            "role": user.role}
