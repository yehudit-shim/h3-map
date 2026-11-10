from fastapi import APIRouter, Depends, Request

from ...auth.deps import editor, viewer
from ...auth.jwt import User
from ...config import API_VERSION, Settings, get_settings
from ...services.connections import PoolManager

public_router = APIRouter(tags=["system"])
router = APIRouter(tags=["system"])


def get_pools(request: Request) -> PoolManager:
    return request.app.state.pools


@public_router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/ready")
async def ready(user: User = Depends(viewer)) -> dict:
    # The data connections are lazy and optional; the app metadata DB is not used by Phase 6A routes.
    return {"status": "ready"}


@router.get("/config")
async def public_config(user: User = Depends(viewer), s: Settings = Depends(get_settings)) -> dict:
    return {"version": API_VERSION,
            "limits": {"maxFeatures": s.max_features, "defaultFeatures": s.default_features,
                       "maxFeaturesNoBbox": s.max_features_no_bbox, "maxH3Cells": s.max_h3_cells,
                       "maxRowsLimit": s.max_rows_limit, "tileFeatureCap": s.tile_feature_cap},
            "thresholds": {"json": s.threshold_json, "bbox": s.threshold_bbox, "mvt": s.threshold_mvt},
            "featureFlags": {"arrow": False, "userConnections": False}}


@router.get("/me")
async def me(user: User = Depends(viewer)) -> dict:
    return {"user": user.sub, "roles": [user.role], "settings": {}}
