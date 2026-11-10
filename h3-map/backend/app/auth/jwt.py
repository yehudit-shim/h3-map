"""JWT creation/verification and password hashing for the single-admin local login."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from dataclasses import dataclass

import jwt as pyjwt

from ..config import Settings

ROLES = ("viewer", "editor", "admin")
ROLE_RANK = {r: i for i, r in enumerate(ROLES)}
_ITER = 200_000


@dataclass(frozen=True)
class User:
    sub: str
    role: str


def hash_password(password: str, salt: bytes | None = None, iterations: int = _ITER) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_hash(password: str, stored: str) -> bool:
    try:
        algo, it, salt, dk = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(it))
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except Exception:
        return False


def check_credentials(settings: Settings, username: str, password: str) -> User | None:
    ok_user = hmac.compare_digest(username.encode(), settings.admin_username.encode())
    if settings.admin_password_hash:
        ok_pw = verify_hash(password, settings.admin_password_hash)
    elif settings.admin_password is not None:
        ok_pw = hmac.compare_digest(password.encode(), settings.admin_password.get_secret_value().encode())
    else:
        return None  # login disabled until a password is configured
    return User(sub=settings.admin_username, role="admin") if ok_user and ok_pw else None


def create_token(settings: Settings, user: User, ttl_s: int | None = None) -> str:
    now = int(time.time())
    payload = {"sub": user.sub, "role": user.role, "iat": now,
               "exp": now + (ttl_s if ttl_s is not None else settings.jwt_ttl_minutes * 60)}
    return pyjwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm="HS256")


def decode_token(settings: Settings, token: str) -> User:
    data = pyjwt.decode(token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"],
                        options={"require": ["exp", "sub", "role"]})
    if data["role"] not in ROLE_RANK:
        raise pyjwt.InvalidTokenError("role")
    return User(sub=str(data["sub"]), role=data["role"])
