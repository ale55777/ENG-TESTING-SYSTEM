from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.ratelimit import limiter
from app.core.security import decode_session_token
from app.database.session import get_db
from app.models import User

DB = Annotated[AsyncSession, Depends(get_db)]


def _token_from_request(request: Request) -> str | None:
    token = request.cookies.get(get_settings().cookie_name)
    if token:
        return token
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


async def get_current_user(request: Request, db: DB) -> User:
    token = _token_from_request(request)
    data = decode_session_token(token) if token else None
    if not data:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        uid = uuid.UUID(data["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    user = await db.get(User, uid)
    if not user or not user.is_active or user.token_version != data.get("tv"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    s = get_settings()
    limiter.check(f"user:{user.id}", s.rate_limit_per_minute * 3)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def ai_rate_limit(user: CurrentUser) -> User:
    limiter.check(f"ai:{user.id}", get_settings().ai_rate_limit_per_minute)
    return user


AIUser = Annotated[User, Depends(ai_rate_limit)]
