"""Zero-config bootstrap state, kept in a small git-ignored directory (default ``backend/data``, ``H3MAP_DATA_DIR``).

Three things cannot live in the application database they protect, so they are generated / stored here when the
environment does not provide them (environment variables always win):

* ``jwt.secret``   signing key of the access tokens (generated on first start)
* ``secret.key``   Fernet key that encrypts stored connection passwords and ``app_db.enc`` (generated on first start)
* ``app_db.enc``   the application-database URL entered on the first-run setup page, Fernet-encrypted

Protect this directory like a ``.env`` file. Losing ``secret.key`` makes stored connection passwords unreadable.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from pydantic import SecretStr

DEFAULT_DIR = Path(__file__).resolve().parents[1] / "data"


def data_dir() -> Path:
    d = Path(os.environ.get("H3MAP_DATA_DIR") or DEFAULT_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_or_create(name: str, make) -> str:
    p = data_dir() / name
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    value = make()
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(value)
    return value


def jwt_secret() -> str:
    return _read_or_create("jwt.secret", lambda: secrets.token_urlsafe(48))


def fernet_key() -> str:
    return _read_or_create("secret.key", lambda: Fernet.generate_key().decode())


def load_app_db_url() -> str | None:
    p = data_dir() / "app_db.enc"
    if not p.exists():
        return None
    try:
        return Fernet(fernet_key().encode()).decrypt(p.read_bytes()).decode()
    except InvalidToken:
        return None  # key changed or file damaged: behave as "not configured" so the setup page can be used again


def save_app_db_url(url: str) -> None:
    (data_dir() / "app_db.enc").write_bytes(Fernet(fernet_key().encode()).encrypt(url.encode()))


def apply(settings):
    """Fill settings the environment left unset from the bootstrap directory."""
    given, update = settings.model_fields_set, {}
    if "jwt_secret" not in given:
        update["jwt_secret"] = SecretStr(jwt_secret())
    if "encryption_key" not in given:
        update["encryption_key"] = SecretStr(fernet_key())
    if "app_database_url" not in given:
        url = load_app_db_url()
        if url:
            update["app_database_url"] = SecretStr(url)
    return settings.model_copy(update=update) if update else settings
