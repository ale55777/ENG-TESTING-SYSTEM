"""Speech-to-text orchestration.

Primary: Groq Whisper (whisper-large-v3-turbo) with word timestamps.
Fallback (no GROQ_API_KEY): local wav2vec2 greedy CTC decoding - lower accuracy, no punctuation,
clearly labelled in results.

Live transcription strategy (Groq has no streaming STT endpoint): the browser segments speech
with a voice-activity detector and uploads (a) the growing current segment every ~2.5 s as a
*partial* and (b) each segment once it closes at a pause as a *final* segment. The authoritative
transcript used for scoring is produced once from the complete recording at the end.
This is chunked transcription, not token-level streaming.
"""
from __future__ import annotations

import asyncio
import time

from app.core.config import get_settings
from app.services.groq.client import Transcription, groq_client
from app.services.registry import ctc_model
from app.services.transcription.audio import DecodedAudio, is_mostly_silent

# Phrases Whisper commonly hallucinates on silence/noise.
_HALLUCINATIONS = {"thank you.", "thanks for watching!", "thank you for watching.", "you", "bye.", "."}


def _drop_hallucinated(t: Transcription) -> Transcription:
    segs = t.segments
    if segs:
        keep = [s for s in segs if not ((s.get("no_speech_prob") or 0) > 0.8 and (s.get("avg_logprob") or 0) < -1.0)]
        if len(keep) != len(segs):
            text = " ".join(s["text"].strip() for s in keep).strip()
            spans = [(s["start"], s["end"]) for s in keep]
            words = [w for w in t.words if any(a - 0.05 <= (w.get("start") or 0) <= b + 0.05 for a, b in spans)]
            t = Transcription(text, words, keep, t.language, t.duration_s, t.model, t.latency_ms)
    if t.text.strip().lower() in _HALLUCINATIONS and len(t.words) <= 3:
        t = Transcription("", [], [], t.language, t.duration_s, t.model, t.latency_ms)
    return t


async def transcribe(audio: DecodedAudio, *, prompt: str | None = None, word_timestamps: bool = True) -> Transcription:
    if is_mostly_silent(audio.samples):
        return Transcription("", [], [], "en", audio.duration_s, "silence-detector", 0)
    if get_settings().groq_configured:
        t = await groq_client.transcribe(audio.wav_bytes, prompt=prompt, word_timestamps=word_timestamps)
        return _drop_hallucinated(t)
    if ctc_model.available:
        t0 = time.perf_counter()
        lp = await asyncio.to_thread(ctc_model.log_probs, audio.samples)
        text = ctc_model.greedy_decode(lp)
        return Transcription(text, [], [], "en", audio.duration_s, "wav2vec2-base-960h (offline fallback)",
                             int((time.perf_counter() - t0) * 1000))
    raise RuntimeError("No speech recognizer available: set GROQ_API_KEY or install the local model (scripts/setup.ps1)")


def transcription_backend() -> str:
    if get_settings().groq_configured:
        return f"groq:{get_settings().groq_stt_model}"
    if ctc_model.available:
        return "offline:wav2vec2-base-960h"
    return "unavailable"
