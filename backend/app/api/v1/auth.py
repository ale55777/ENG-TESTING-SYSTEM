from __future__ import annotations

import asyncio
import logging
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.deps import DB, CurrentUser
from app.core.ratelimit import limiter
from app.core.security import (
    create_session_token,
    hash_password,
    hash_reset_token,
    new_reset_token,
    verify_password,
)
from app.models import LearningPreference, PasswordResetToken, User, UserProfile

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger(__name__)

LEVELS = ("beginner", "intermediate", "advanced")


def _password_rules(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not any(c.isalpha() for c in v) or not any(c.isdigit() for c in v):
        raise ValueError("Password must contain letters and numbers")
    return v


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)
    display_name: str = Field(min_length=1, max_length=80)
    proficiency_level: str = "beginner"

    _pw = field_validator("password")(_password_rules)

    @field_validator("proficiency_level")
    @classmethod
    def _lvl(cls, v: str) -> str:
        if v not in LEVELS:
            raise ValueError("invalid level")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class ResetRequestIn(BaseModel):
    email: EmailStr


class ResetConfirmIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(max_length=200)

    _pw = field_validator("new_password")(_password_rules)


def user_out(u: User) -> dict:
    p, pref = u.profile, u.preferences
    return {
        "id": str(u.id),
        "email": u.email,
        "role": u.role,
        "display_name": p.display_name if p else u.email,
        "proficiency_level": p.proficiency_level if p else "beginner",
        "learning_goals": p.learning_goals if p else "",
        "audio_retention_consent": p.audio_retention_consent if p else False,
        "preferred_difficulty": pref.preferred_difficulty if pref else "beginner",
        "preferred_voice": pref.preferred_voice if pref else "F1",
        "playback_speed": pref.playback_speed if pref else 1.0,
        "daily_goal_minutes": pref.daily_goal_minutes if pref else 15,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def _set_session_cookie(response: Response, user: User) -> None:
    s = get_settings()
    token, exp = create_session_token(user.id, user.role, user.token_version)
    response.set_cookie(
        s.cookie_name, token, httponly=True, secure=s.cookie_secure, samesite="lax",
        max_age=s.jwt_expires_minutes * 60, path="/",
    )


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/register", status_code=201)
async def register(body: RegisterIn, request: Request, response: Response, db: DB) -> dict:
    limiter.check(f"register:{_client_ip(request)}", 10, 3600)
    email = body.email.lower()
    if await db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    # First account on a fresh install becomes administrator.
    is_first = (await db.scalar(select(func.count()).select_from(User))) == 0
    user = User(email=email, password_hash=hash_password(body.password), role="admin" if is_first else "learner")
    user.profile = UserProfile(display_name=body.display_name.strip(), proficiency_level=body.proficiency_level)
    user.preferences = LearningPreference(preferred_difficulty=body.proficiency_level)
    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    _set_session_cookie(response, user)
    return {"user": user_out(user)}


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: DB) -> dict:
    limiter.check(f"login:{_client_ip(request)}", 20, 300)
    limiter.check(f"login-email:{body.email.lower()}", 10, 300)
    user = await db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is disabled")
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    _set_session_cookie(response, user)
    return {"user": user_out(user)}


@router.post("/logout")
async def logout(response: Response) -> dict:
    s = get_settings()
    response.delete_cookie(s.cookie_name, path="/", samesite="lax", secure=s.cookie_secure, httponly=True)
    return {"ok": True}


@router.post("/logout-all")
async def logout_all(user: CurrentUser, response: Response, db: DB) -> dict:
    user.token_version += 1
    await db.commit()
    s = get_settings()
    response.delete_cookie(s.cookie_name, path="/", samesite="lax", secure=s.cookie_secure, httponly=True)
    return {"ok": True}


@router.get("/me")
async def me(user: CurrentUser) -> dict:
    return {"user": user_out(user)}


@router.get("/password-reset/available")
async def reset_available() -> dict:
    return {"available": get_settings().email_configured}


def _send_mail(to: str, subject: str, text: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(text)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)


@router.post("/password-reset/request")
async def reset_request(body: ResetRequestIn, request: Request, db: DB) -> dict:
    s = get_settings()
    if not s.email_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Password reset by email is not configured on this server. Contact an administrator.")
    limiter.check(f"reset:{_client_ip(request)}", 5, 3600)
    user = await db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if user and user.is_active:
        raw, hashed = new_reset_token()
        db.add(PasswordResetToken(user_id=user.id, token_hash=hashed,
                                  expires_at=datetime.now(timezone.utc) + timedelta(minutes=30)))
        await db.commit()
        link = f"{s.frontend_origin}/reset-password?token={raw}"
        try:
            await asyncio.to_thread(_send_mail, user.email, "Reset your password",
                                    f"Use this link within 30 minutes to reset your password:\n\n{link}\n\nIf you did not request this, ignore this email.")
        except Exception:
            log.exception("Failed to send reset email")
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not send the reset email. Try again later.")
    # Same response whether or not the account exists (no account enumeration).
    return {"ok": True, "message": "If the account exists, a reset link has been sent."}


@router.post("/password-reset/confirm")
async def reset_confirm(body: ResetConfirmIn, db: DB) -> dict:
    tok = await db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_reset_token(body.token)))
    now = datetime.now(timezone.utc)
    exp = tok.expires_at.replace(tzinfo=timezone.utc) if tok and tok.expires_at.tzinfo is None else (tok.expires_at if tok else None)
    if not tok or tok.used_at or exp < now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has expired")
    user = await db.get(User, tok.user_id)
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has expired")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    tok.used_at = now
    await db.commit()
    return {"ok": True}
