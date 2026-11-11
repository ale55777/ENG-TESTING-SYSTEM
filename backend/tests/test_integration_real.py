"""Optional integration tests against real services and local models.

Run with:  pytest -m integration
Groq tests additionally require GROQ_API_KEY in the environment (they make small billed calls).
"""
from __future__ import annotations

import os

import pytest

from app.core.config import BACKEND_DIR

pytestmark = pytest.mark.integration
MODELS = BACKEND_DIR / "models"


@pytest.mark.skipif(not (MODELS / "wav2vec2-base-960h" / "vocab.json").exists() or not (MODELS / "supertonic3" / "onnx").exists(),
                    reason="local models not downloaded")
def test_tts_and_pronunciation_roundtrip(tmp_path):
    from app.services.pronunciation.assessor import assess_pronunciation
    from app.services.pronunciation.ctc_model import CTCModel
    from app.services.transcription.audio import decode_audio
    from app.services.tts.supertonic_service import SupertonicService

    tts = SupertonicService(str(MODELS / "supertonic3"), str(tmp_path))
    text = "Speaking clearly helps people communicate their ideas."
    wav, hit = tts.synthesize_wav(text, "F2")
    assert not hit and tts.synthesize_wav(text, "F2")[1]  # second call is cached
    audio = decode_audio(wav, 10**8, 300)
    model = CTCModel(str(MODELS / "wav2vec2-base-960h"))
    good = assess_pronunciation(model, audio.samples, text)
    bad = assess_pronunciation(model, audio.samples, "Shouting loudly hurts animals and their feelings.")
    assert good.available and good.overall_score > 85
    assert bad.overall_score < good.overall_score - 25


@pytest.mark.skipif(not os.environ.get("GROQ_API_KEY"), reason="GROQ_API_KEY not set")
@pytest.mark.asyncio
async def test_groq_live():
    from app.core.config import get_settings

    get_settings.cache_clear()
    from app.services.groq import generation
    from app.services.groq.client import groq_client

    h = await groq_client.health()
    assert h["ok"] and h["chat_model_available"] and h["stt_model_available"]
    data, meta = await generation.generate_tongue_twister("beginner", "s")
    assert data["content"] and meta["model"]
