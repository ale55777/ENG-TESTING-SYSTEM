from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.core.deps import CurrentUser
from app.realtime.ably import create_token
from app.core.config import get_settings

router = APIRouter(prefix="/realtime", tags=["realtime"])


@router.get("/token")
async def ably_token(user: CurrentUser) -> dict:
    """Short-lived Ably JWT scoped to the caller's own channel (subscribe + history only)."""
    if not get_settings().ably_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Realtime updates are not configured (ABLY_API_KEY missing)")
    return create_token(user.id)


@router.get("/status")
async def realtime_status(user: CurrentUser) -> dict:
    return {"enabled": get_settings().ably_configured}
