from __future__ import annotations

import time

from fastapi import APIRouter
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.deps import DB
from app.models import DifficultyLevel
from app.realtime.ably import publisher
from app.services.groq.client import groq_client
from app.services.registry import ctc_model, tts_service
from app.services.transcription.service import transcription_backend

router = APIRouter(tags=["health"])


async def service_health(db, deep: bool = False) -> dict:
    s = get_settings()
    t0 = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        db_ok, db_detail = True, None
    except Exception as exc:
        db_ok, db_detail = False, exc.__class__.__name__
    db_ms = int((time.perf_counter() - t0) * 1000)
    out = {
        "status": "ok" if db_ok else "degraded",
        "environment": s.app_env,
        "database": {"ok": db_ok, "latency_ms": db_ms, "detail": db_detail},
        "features": {
            "groq": s.groq_configured,
            "realtime": s.ably_configured,
            "transcription": transcription_backend(),
            "pronunciation_model": ctc_model.available,
            "tts": tts_service.status()["available"],
            "password_reset_email": s.email_configured,
        },
        "privacy": {
            "audio_retained": False,
            "external_processing": "Audio is sent to GroqCloud for transcription when GROQ_API_KEY is configured." if s.groq_configured
            else "No external speech processing is configured; the local offline recognizer is used.",
        },
    }
    if deep:
        out["groq"] = await groq_client.health()
        out["ably"] = await publisher.health()
        out["tts"] = tts_service.status()
        out["pronunciation"] = {"available": ctc_model.available, "model": ctc_model.MODEL_NAME, "error": ctc_model.error}
        try:
            out["database"]["seeded_levels"] = len((await db.scalars(select(DifficultyLevel))).all())
        except Exception:
            pass
    return out


@router.get("/health")
async def health(db: DB) -> dict:
    return await service_health(db)
