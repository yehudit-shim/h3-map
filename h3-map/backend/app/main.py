"""FastAPI application factory."""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.cors import CORSMiddleware

from .api.v1 import router as v1_router
from .config import API_VERSION, Settings, get_settings
from .errors import install_handlers
from .logging_setup import register_secret, setup_logging
from .services.connections import PoolManager, load_connection_defs

log = logging.getLogger("h3map")


def create_app(settings: Settings | None = None, connection_defs: dict | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.log_level)
    for s in (settings.admin_password, settings.jwt_secret):
        if s is not None:
            register_secret(s.get_secret_value())

    defs = connection_defs if connection_defs is not None else load_connection_defs(settings)
    store = None
    if settings.app_database_url and settings.encryption_key:
        from .services.user_connections import UserConnectionStore
        register_secret(settings.encryption_key.get_secret_value())
        register_secret(settings.app_database_url.get_secret_value())
        store = UserConnectionStore(settings.app_database_url.get_secret_value(), settings.encryption_key.get_secret_value())
    pools = PoolManager(settings, defs, store)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            await pools.load_user_defs()
        except Exception as exc:  # the app DB being down must not stop the env connections from working
            log.warning("could not load user connections: %s", type(exc).__name__)
        yield
        await pools.close()

    app = FastAPI(title="H3 Map API", version=API_VERSION, lifespan=lifespan,
                  openapi_url="/api/v1/openapi.json", docs_url="/api/v1/docs", redoc_url=None)
    app.state.settings = settings
    app.state.pools = pools
    app.dependency_overrides[get_settings] = lambda: settings
    install_handlers(app)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"],
                       expose_headers=["ETag", "X-Request-Id"])

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    app.include_router(v1_router, prefix="/api/v1")
    return app


def app_factory() -> FastAPI:  # uvicorn --factory app.main:app_factory
    return create_app()
