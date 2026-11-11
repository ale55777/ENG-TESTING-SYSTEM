from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete

from app.api.v1.auth import LEVELS, _password_rules, user_out
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser
from app.core.security import hash_password, verify_password
from app.models import LearningRecommendation, PracticeAttempt, ProgressSnapshot, Report
from app.services.tts.supertonic_service import VOICES

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    proficiency_level: str | None = None
    learning_goals: str | None = Field(default=None, max_length=1000)
    preferred_difficulty: str | None = None
    preferred_voice: str | None = None
    playback_speed: float | None = Field(default=None, ge=0.7, le=1.6)
    daily_goal_minutes: int | None = Field(default=None, ge=5, le=240)

    @field_validator("proficiency_level", "preferred_difficulty")
    @classmethod
    def _lvl(cls, v: str | None) -> str | None:
        if v is not None and v not in LEVELS:
            raise ValueError("invalid level")
        return v

    @field_validator("preferred_voice")
    @classmethod
    def _voice(cls, v: str | None) -> str | None:
        if v is not None and v not in VOICES:
            raise ValueError("unknown voice")
        return v


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)

    _pw = field_validator("new_password")(_password_rules)


class DeleteAccount(BaseModel):
    password: str = Field(max_length=200)


@router.get("")
async def get_profile(user: CurrentUser) -> dict:
    return {"user": user_out(user)}


@router.patch("")
async def update_profile(body: ProfileUpdate, user: CurrentUser, db: DB) -> dict:
    p, pref = user.profile, user.preferences
    data = body.model_dump(exclude_none=True)
    for k in ("display_name", "proficiency_level", "learning_goals"):
        if k in data:
            setattr(p, k, data[k].strip() if isinstance(data[k], str) else data[k])
    for k in ("preferred_difficulty", "preferred_voice", "playback_speed", "daily_goal_minutes"):
        if k in data:
            setattr(pref, k, data[k])
    await db.commit()
    await db.refresh(user)
    return {"user": user_out(user)}


@router.post("/password")
async def change_password(body: PasswordChange, user: CurrentUser, db: DB) -> dict:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"ok": True}


@router.delete("/history")
async def delete_history(user: CurrentUser, db: DB) -> dict:
    """Delete all practice attempts (transcripts, alignments, scores, feedback) and derived data."""
    res = await db.execute(delete(PracticeAttempt).where(PracticeAttempt.user_id == user.id))
    await db.execute(delete(ProgressSnapshot).where(ProgressSnapshot.user_id == user.id))
    await db.execute(delete(LearningRecommendation).where(LearningRecommendation.user_id == user.id))
    await db.execute(delete(Report).where(Report.user_id == user.id))
    await db.commit()
    return {"deleted_attempts": res.rowcount or 0}


@router.post("/delete-account")
async def delete_account(body: DeleteAccount, user: CurrentUser, response: Response, db: DB) -> dict:
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is incorrect")
    await db.delete(user)
    await db.commit()
    s = get_settings()
    response.delete_cookie(s.cookie_name, path="/")
    return {"ok": True}
