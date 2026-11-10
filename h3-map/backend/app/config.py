"""Application settings (environment variables, prefix ``H3MAP_``)."""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

API_VERSION = "0.1.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="H3MAP_", env_file=".env", extra="ignore")

    # --- auth -------------------------------------------------------------
    jwt_secret: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me")
    jwt_ttl_minutes: int = Field(60, ge=1, le=60 * 24 * 7)
    admin_username: str = "admin"
    # Either a plain password (dev) or a hash made by app.auth.jwt.hash_password.
    admin_password: SecretStr | None = None
    admin_password_hash: str | None = None

    # --- connections ------------------------------------------------------
    connections_file: str | None = "connections.yaml"
    # Hosts that are allowed even though they resolve to loopback/private ranges.
    host_allowlist: list[str] = ["localhost", "127.0.0.1", "postgis"]
    allow_private_hosts: bool = True  # dev default; set false in production
    pool_max_size: int = Field(10, ge=1, le=50)
    pool_timeout_s: float = Field(10.0, gt=0, le=60)
    statement_timeout_ms: int = Field(30_000, ge=100, le=600_000)
    idle_in_tx_timeout_ms: int = Field(30_000, ge=100, le=600_000)
    lock_timeout_ms: int = Field(2_000, ge=100, le=60_000)

    # --- limits (exposed by /config) -------------------------------------
    max_features: int = Field(100_000, ge=1, le=1_000_000)
    default_features: int = Field(10_000, ge=1, le=1_000_000)
    max_features_no_bbox: int = Field(50_000, ge=1)
    max_h3_cells: int = Field(250_000, ge=1, le=2_000_000)
    max_h3_scan_rows: int = Field(1_000_000, ge=1)
    max_rows_limit: int = Field(1_000, ge=1, le=10_000)
    max_filter_depth: int = Field(6, ge=1, le=20)
    max_filter_nodes: int = Field(50, ge=1, le=500)
    max_geometry_vertices: int = Field(10_000, ge=10)
    # strategy thresholds (estimated rows)
    threshold_json: int = 10_000
    threshold_bbox: int = 100_000
    threshold_mvt: int = 10_000_000

    # --- tiles ------------------------------------------------------------
    tile_feature_cap: int = Field(50_000, ge=1, le=1_000_000)
    tile_session_ttl_s: int = Field(8 * 3600, ge=60)
    tile_max_sessions: int = Field(200, ge=1)
    tile_cache_max_age_s: int = Field(60, ge=0)

    # --- misc -------------------------------------------------------------
    cors_origins: list[str] = ["http://localhost:5173"]
    h3_sql: str = Field("auto", pattern="^(auto|off)$")  # use h3-pg when available
    # app metadata DB (users' saved connections and grants). Both are needed to enable user-defined connections.
    app_database_url: SecretStr | None = None
    encryption_key: SecretStr | None = None  # Fernet key: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
