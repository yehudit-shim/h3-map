"""v1 router. Every router except the public ones carries an auth dependency."""
from fastapi import APIRouter, Depends

from ...auth.deps import viewer
from .access import connection_access
from . import auth, catalog, connections, features, h3, setup, system, tables, tiles, users

router = APIRouter()
router.include_router(system.public_router)  # /health only
router.include_router(auth.router)           # /auth/login only (credentials are the auth)
router.include_router(setup.router)          # first-run setup: public, but locked by needs_setup + one-time token
for r in (system.router, connections.router, catalog.router, tables.router, features.router, tiles.router, h3.router, users.router):
    router.include_router(r, dependencies=[Depends(viewer), Depends(connection_access)])  # per-route deps raise the required role
