"""Administration endpoints. Every route requires role=admin.

Admins see aggregate usage and content - never learners' transcripts, recordings or feedback.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.v1.exercises import exercise_out
from app.api.v1.health import service_health
from app.core.deps import DB, AdminUser
from app.database.seed import content_hash
from app.models import DifficultyLevel, Exercise, ExerciseCategory, PracticeAttempt, SystemErrorLog, User

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
async def overview(admin: AdminUser, db: DB) -> dict:
    now = datetime.now(timezone.utc)
    week = now - timedelta(days=7)
    users = await db.scalar(select(func.count()).select_from(User))
    active7 = await db.scalar(select(func.count(func.distinct(PracticeAttempt.user_id))).where(PracticeAttempt.created_at >= week))
    attempts = await db.scalar(select(func.count()).select_from(PracticeAttempt))
    by_type = dict((await db.execute(select(PracticeAttempt.exercise_type, func.count()).group_by(PracticeAttempt.exercise_type))).all())
    since = (now - timedelta(days=13)).date()
    daily = (await db.execute(
        select(func.date(PracticeAttempt.created_at), func.count())
        .where(PracticeAttempt.created_at >= datetime(since.year, since.month, since.day, tzinfo=timezone.utc))
        .group_by(func.date(PracticeAttempt.created_at)).order_by(func.date(PracticeAttempt.created_at))
    )).all()
    ex_counts = dict((await db.execute(select(Exercise.status, func.count()).group_by(Exercise.status))).all())
    ai_ex = await db.scalar(select(func.count()).select_from(Exercise).where(Exercise.source == "ai"))
    errors24 = await db.scalar(select(func.count()).select_from(SystemErrorLog).where(SystemErrorLog.created_at >= now - timedelta(days=1)))
    return {
        "users": users, "active_users_7d": active7, "attempts": attempts, "attempts_by_type": by_type,
        "attempts_daily": [{"day": str(d), "count": c} for d, c in daily],
        "exercises_by_status": ex_counts, "ai_generated_exercises": ai_ex, "errors_24h": errors24,
    }


@router.get("/health")
async def health(admin: AdminUser, db: DB) -> dict:
    return await service_health(db, deep=True)


@router.get("/errors")
async def errors(admin: AdminUser, db: DB, limit: int = Query(100, ge=1, le=500)) -> dict:
    rows = (await db.scalars(select(SystemErrorLog).order_by(SystemErrorLog.created_at.desc()).limit(limit))).all()
    return {"items": [{"id": r.id, "created_at": r.created_at.isoformat(), "source": r.source, "path": r.path,
                       "status_code": r.status_code, "message": r.message} for r in rows]}


# ------------------------------------------------ users (aggregate only)
@router.get("/users")
async def users(admin: AdminUser, db: DB, limit: int = Query(100, ge=1, le=500)) -> dict:
    counts = dict((await db.execute(select(PracticeAttempt.user_id, func.count()).group_by(PracticeAttempt.user_id))).all())
    rows = (await db.scalars(select(User).order_by(User.created_at.desc()).limit(limit))).all()
    return {"items": [{"id": str(u.id), "email": u.email, "display_name": u.profile.display_name if u.profile else "",
                       "role": u.role, "is_active": u.is_active, "attempts": counts.get(u.id, 0),
                       "created_at": u.created_at.isoformat(), "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}
                      for u in rows]}


class UserPatch(BaseModel):
    role: Literal["learner", "admin"] | None = None
    is_active: bool | None = None


@router.patch("/users/{user_id}")
async def patch_user(user_id: uuid.UUID, body: UserPatch, admin: AdminUser, db: DB) -> dict:
    u = await db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == admin.id and (body.role == "learner" or body.is_active is False):
        raise HTTPException(400, "You cannot demote or deactivate yourself")
    if body.role:
        u.role = body.role
        u.token_version += 1
    if body.is_active is not None:
        u.is_active = body.is_active
        u.token_version += 1
    await db.commit()
    return {"ok": True}


# ------------------------------------------------ exercises
class ExerciseIn(BaseModel):
    exercise_type: Literal["reading", "tongue_twister", "pronunciation", "speaking", "typing"]
    difficulty: Literal["beginner", "intermediate", "advanced"]
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=3000)
    category_id: int | None = None
    details: dict = Field(default_factory=dict)


class ExercisePatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = Field(default=None, max_length=3000)
    difficulty: Literal["beginner", "intermediate", "advanced"] | None = None
    category_id: int | None = None
    details: dict | None = None
    status: Literal["active", "flagged", "hidden"] | None = None


@router.get("/exercises")
async def list_exercises(admin: AdminUser, db: DB, exercise_type: str | None = Query(None, alias="type"),
                         status: str | None = None, source: str | None = None, limit: int = Query(100, le=500)) -> dict:
    q = select(Exercise)
    if exercise_type:
        q = q.where(Exercise.exercise_type == exercise_type)
    if status:
        q = q.where(Exercise.status == status)
    if source:
        q = q.where(Exercise.source == source)
    rows = (await db.scalars(q.order_by(Exercise.created_at.desc()).limit(limit))).all()
    return {"items": [exercise_out(e) | {"status": e.status, "flag_reason": e.flag_reason} for e in rows]}


@router.post("/exercises", status_code=201)
async def create_exercise(body: ExerciseIn, admin: AdminUser, db: DB) -> dict:
    content = " ".join(body.content.split())
    e = Exercise(exercise_type=body.exercise_type, difficulty=body.difficulty, title=body.title.strip(), content=content,
                 category_id=body.category_id, details=body.details, source="predefined", status="active",
                 content_hash=content_hash(body.exercise_type, content))
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return {"exercise": exercise_out(e)}


@router.patch("/exercises/{exercise_id}")
async def update_exercise(exercise_id: uuid.UUID, body: ExercisePatch, admin: AdminUser, db: DB) -> dict:
    e = await db.get(Exercise, exercise_id)
    if not e:
        raise HTTPException(404, "Exercise not found")
    data = body.model_dump(exclude_unset=True)
    if "content" in data and data["content"]:
        e.content = " ".join(data.pop("content").split())
        e.content_hash = content_hash(e.exercise_type, e.content)  # in-progress attempts get a 409 and restart
    for k, v in data.items():
        setattr(e, k, v)
    if body.status == "active":
        e.flag_reason = None
    await db.commit()
    await db.refresh(e)
    return {"exercise": exercise_out(e) | {"status": e.status}}


@router.delete("/exercises/{exercise_id}")
async def delete_exercise(exercise_id: uuid.UUID, admin: AdminUser, db: DB) -> dict:
    e = await db.get(Exercise, exercise_id)
    if not e:
        raise HTTPException(404, "Exercise not found")
    await db.delete(e)  # attempts keep their frozen reference text (exercise_id set NULL)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------ categories & difficulty levels
class CategoryIn(BaseModel):
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=100)
    exercise_type: Literal["reading", "tongue_twister", "pronunciation", "speaking", "typing"]
    description: str = Field(default="", max_length=500)
    is_active: bool = True


@router.get("/categories")
async def categories(admin: AdminUser, db: DB) -> dict:
    rows = (await db.scalars(select(ExerciseCategory).order_by(ExerciseCategory.exercise_type, ExerciseCategory.name))).all()
    return {"items": [{"id": c.id, "slug": c.slug, "name": c.name, "exercise_type": c.exercise_type,
                       "description": c.description, "is_active": c.is_active} for c in rows]}


@router.post("/categories", status_code=201)
async def create_category(body: CategoryIn, admin: AdminUser, db: DB) -> dict:
    if await db.scalar(select(ExerciseCategory).where(ExerciseCategory.slug == body.slug)):
        raise HTTPException(409, "Slug already exists")
    c = ExerciseCategory(**body.model_dump())
    db.add(c)
    await db.commit()
    return {"id": c.id}


@router.put("/categories/{cat_id}")
async def update_category(cat_id: int, body: CategoryIn, admin: AdminUser, db: DB) -> dict:
    c = await db.get(ExerciseCategory, cat_id)
    if not c:
        raise HTTPException(404, "Category not found")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    await db.commit()
    return {"ok": True}


class LevelPatch(BaseModel):
    label: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=500)
    tts_speed: float | None = Field(default=None, ge=0.7, le=1.6)
    is_active: bool | None = None


@router.get("/difficulty-levels")
async def levels(admin: AdminUser, db: DB) -> dict:
    rows = (await db.scalars(select(DifficultyLevel).order_by(DifficultyLevel.sort_order))).all()
    return {"items": [{"id": lv.id, "code": lv.code, "label": lv.label, "description": lv.description,
                       "tts_speed": lv.tts_speed, "is_active": lv.is_active} for lv in rows]}


@router.patch("/difficulty-levels/{level_id}")
async def patch_level(level_id: int, body: LevelPatch, admin: AdminUser, db: DB) -> dict:
    lv = await db.get(DifficultyLevel, level_id)
    if not lv:
        raise HTTPException(404, "Level not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(lv, k, v)
    await db.commit()
    return {"ok": True}
