from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.core.deps import CurrentUser
from app.core.ratelimit import limiter
from app.services.registry import tts_service
from app.services.tts.supertonic_service import MAX_TTS_CHARS, VOICES, TTSUnavailable

router = APIRouter(prefix="/tts", tags=["tts"])


class TTSIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    voice: str = "F1"
    speed: float = Field(default=1.0, ge=0.7, le=1.6)
    quality: int = Field(default=8, ge=4, le=12)


@router.get("/voices")
async def voices(user: CurrentUser) -> dict:
    return {"voices": VOICES, **tts_service.status()}


@router.post("")
async def synthesize(body: TTSIn, user: CurrentUser) -> Response:
    limiter.check(f"tts:{user.id}", 40)
    try:
        wav, hit = await asyncio.to_thread(tts_service.synthesize_wav, body.text, body.voice, body.speed, body.quality)
    except TTSUnavailable as exc:
        raise HTTPException(503, f"Reference audio is unavailable: {exc}")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return Response(wav, media_type="audio/wav", headers={"X-TTS-Cache": "hit" if hit else "miss",
                                                           "Cache-Control": "private, max-age=86400"})
