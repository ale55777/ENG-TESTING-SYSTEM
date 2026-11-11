from __future__ import annotations

import random
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.core.deps import DB, AIUser, CurrentUser
from app.database.seed import content_hash
from app.models import Exercise
from app.models.exercise import DIFFICULTIES, EXERCISE_TYPES
from app.realtime.ably import EventSession
from app.services.groq import generation
from app.services.groq.client import GroqError, GroqNotConfigured
from app.services.groq.content_policy import ContentRejected

router = APIRouter(prefix="/exercises", tags=["exercises"])


def exercise_out(e: Exercise) -> dict:
    return {
        "id": str(e.id),
        "exercise_type": e.exercise_type,
        "difficulty": e.difficulty,
        "title": e.title,
        "content": e.content,
        "details": e.details or {},
        "source": e.source,
        "category": e.category.name if e.category else None,
        "content_hash": e.content_hash,
        "ai_model": e.ai_model,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def visible_to(user_id: uuid.UUID):
    """Predefined active exercises, plus AI exercises the user generated themselves (unless hidden)."""
    return or_(
        (Exercise.source == "predefined") & (Exercise.status == "active"),
        (Exercise.created_by_user_id == user_id) & (Exercise.status != "hidden"),
    )


async def get_visible_exercise(db, user, exercise_id: uuid.UUID) -> Exercise:
    e = await db.scalar(select(Exercise).where(Exercise.id == exercise_id, visible_to(user.id)))
    if not e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
    return e


@router.get("")
async def list_exercises(
    user: CurrentUser,
    db: DB,
    exercise_type: str = Query(..., alias="type"),
    difficulty: str | None = None,
    source: Literal["predefined", "ai", "all"] = "all",
    limit: int = Query(50, ge=1, le=100),
) -> dict:
    if exercise_type not in EXERCISE_TYPES:
        raise HTTPException(400, "Unknown exercise type")
    q = select(Exercise).where(Exercise.exercise_type == exercise_type, visible_to(user.id))
    if difficulty:
        q = q.where(Exercise.difficulty == difficulty)
    if source != "all":
        q = q.where(Exercise.source == source)
    rows = (await db.scalars(q.order_by(Exercise.source.desc(), Exercise.created_at.desc()).limit(limit))).all()
    return {"items": [exercise_out(e) for e in rows]}


@router.get("/random")
async def random_exercise(user: CurrentUser, db: DB, exercise_type: str = Query(..., alias="type"), difficulty: str | None = None) -> dict:
    q = select(Exercise).where(Exercise.exercise_type == exercise_type, Exercise.source == "predefined", Exercise.status == "active")
    if difficulty:
        q = q.where(Exercise.difficulty == difficulty)
    rows = (await db.scalars(q)).all()
    if not rows:
        raise HTTPException(404, "No predefined exercises available")
    return {"exercise": exercise_out(random.choice(rows))}


@router.get("/{exercise_id}")
async def get_exercise(exercise_id: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    return {"exercise": exercise_out(await get_visible_exercise(db, user, exercise_id))}


class GenerateIn(BaseModel):
    exercise_type: Literal["reading", "tongue_twister", "speaking", "typing"]
    difficulty: Literal["beginner", "intermediate", "advanced"] = "beginner"
    topic: str = Field(default="", max_length=80)
    length: Literal["short", "medium", "long"] = "short"
    vocabulary: Literal["simple", "moderate", "rich"] = "moderate"
    mode: Literal["standard", "story", "news"] = "standard"
    part: int = Field(default=1, ge=1, le=3)
    focus_sound: str = Field(default="", max_length=20)


@router.post("/generate", status_code=201)
async def generate_exercise(body: GenerateIn, user: AIUser, db: DB) -> dict:
    try:
        if body.exercise_type in ("reading", "typing"):
            data, meta = await generation.generate_paragraph(body.topic, body.difficulty, body.length, body.vocabulary, body.mode)
        elif body.exercise_type == "tongue_twister":
            data, meta = await generation.generate_tongue_twister(body.difficulty, body.focus_sound or None)
        else:
            data, meta = await generation.generate_speaking_question(body.part, body.topic or None, body.difficulty)
    except GroqNotConfigured:
        raise HTTPException(503, "AI generation is unavailable because GROQ_API_KEY is not configured. Use the predefined exercises instead.")
    except GroqError as exc:
        raise HTTPException(502 if (exc.status_code or 500) >= 500 else 503, f"AI generation failed: {exc}. Predefined exercises are still available.")
    except (ContentRejected, ValueError) as exc:
        raise HTTPException(502, f"Generated content did not pass validation ({exc}). Please try again.")

    e = Exercise(
        exercise_type=body.exercise_type,
        difficulty=body.difficulty,
        title=data["title"],
        content=data["content"],
        details=data["details"],
        source="ai",
        status="active",
        created_by_user_id=user.id,
        ai_model=meta.get("model"),
        content_hash=content_hash(body.exercise_type, data["content"]),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    await EventSession(user.id).emit("exercise.created", {"exercise_id": str(e.id), "exercise_type": e.exercise_type})
    return {"exercise": exercise_out(e), "ai": {"model": meta.get("model"), "latency_ms": meta.get("latency_ms")}}


@router.post("/{exercise_id}/report")
async def report_exercise(exercise_id: uuid.UUID, user: CurrentUser, db: DB, reason: str = Query("", max_length=300)) -> dict:
    """Learners can flag inappropriate AI content; admins review flagged items."""
    e = await get_visible_exercise(db, user, exercise_id)
    if e.source == "ai":
        e.status = "flagged"
        e.flag_reason = reason or "Reported by learner"
        await db.commit()
    return {"ok": True}


__all__ = ["router", "exercise_out", "get_visible_exercise", "DIFFICULTIES"]
