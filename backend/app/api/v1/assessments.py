"""Speech + typing assessment endpoints.

Audio travels browser -> FastAPI (multipart upload over HTTPS). It is processed in memory and
never written to disk or the database (no audio retention). Progress events go out over Ably.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.api.v1.exercises import get_visible_exercise
from app.core.config import get_settings
from app.core.deps import DB, AIUser, CurrentUser
from app.core.ratelimit import limiter
from app.database.session import SessionLocal
from app.models import (
    PracticeAttempt,
    PronunciationAssessment,
    SpeakingAssessment,
    SpeechTranscript,
    TypingResult,
    WordAlignment,
)
from app.realtime.ably import DeltaCoalescer, EventSession
from app.services.feedback import engine as feedback_engine
from app.services.groq.client import GroqError
from app.services.pronunciation.assessor import assess_pronunciation
from app.services.reading.alignment import align_texts
from app.services.recommendations.engine import refresh_recommendations
from app.services.registry import ctc_model
from app.services.scoring.attempts import attempt_detail, update_progress_snapshot
from app.services.speaking.fluency import compute_fluency, fluency_estimate, voiced_frames
from app.services.transcription import service as stt
from app.services.transcription.audio import AudioValidationError, DecodedAudio, decode_audio
from app.services.typing.metrics import TypingValidationError, compute_typing_metrics, typing_tips

router = APIRouter(tags=["assessments"])
log = logging.getLogger(__name__)
_SID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _sid(session_id: str | None) -> str:
    if session_id and _SID_RE.match(session_id):
        return session_id
    return uuid.uuid4().hex


async def _read_audio(upload: UploadFile, min_seconds: float = 0.3) -> DecodedAudio:
    s = get_settings()
    data = await upload.read(s.max_audio_upload_bytes + 1)
    try:
        return await asyncio.to_thread(decode_audio, data, s.max_audio_upload_bytes, s.max_audio_seconds, min_seconds)
    except AudioValidationError as exc:
        raise HTTPException(422, str(exc))


def _started_at(client_ms: int | None, duration_s: float) -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    fallback = end - timedelta(seconds=duration_s)
    if client_ms:
        st = datetime.fromtimestamp(client_ms / 1000, tz=timezone.utc)
        if fallback - timedelta(minutes=30) <= st <= end:
            return st, end
    return fallback, end


async def _transcribe_or_http(audio: DecodedAudio, **kw):
    try:
        return await stt.transcribe(audio, **kw)
    except GroqError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Transcription failed: {exc}. Please try again.")
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


def _speaking_window_s(audio: DecodedAudio) -> float:
    v = voiced_frames(audio.samples)
    import numpy as np

    idx = np.flatnonzero(v)
    return float((idx[-1] - idx[0] + 1) * 0.02) if idx.size else 0.0


# ---------------------------------------------------------------- live chunks
@router.post("/speech/transcribe-chunk")
async def transcribe_chunk(
    user: CurrentUser,
    audio: UploadFile,
    session_id: Annotated[str, Form()],
    segment_index: Annotated[int, Form(ge=0, le=10000)],
    kind: Annotated[Literal["partial", "final"], Form()] = "partial",
) -> dict:
    """Transcribe one VAD segment (or a snapshot of the growing segment) for live display only."""
    limiter.check(f"chunk:{user.id}", 90)
    sid = _sid(session_id)
    dec = await _read_audio(audio, min_seconds=0.2)
    t = await _transcribe_or_http(dec, word_timestamps=False)
    ev = EventSession(user.id, f"{sid}-c{segment_index}{kind[0]}")
    event_type = "transcript.final" if kind == "final" else "transcript.partial"
    event_id = await ev.emit(event_type, {"segment_index": segment_index, "text": t.text, "live": True})
    return {"segment_index": segment_index, "kind": kind, "text": t.text, "model": t.model,
            "latency_ms": t.latency_ms, "event_id": event_id}


# ---------------------------------------------------------------- feedback tasks
def _rule_based_reading_feedback(metrics: dict, pron: dict | None) -> dict:
    tips: list[str] = []
    if metrics.get("deletions"):
        tips.append(f"{metrics['deletions']} word(s) were not detected. Read every word, including short ones like 'the' and 'a'.")
    if metrics.get("substitutions"):
        ex = [m for m in metrics.get("mismatch_examples", []) if m["type"] == "substitution"][:3]
        if ex:
            tips.append("Words heard differently: " + ", ".join(f"'{m['expected']}' (heard '{m['heard']}')" for m in ex) + ". Listen to the reference audio and repeat them.")
    if metrics.get("repetitions"):
        tips.append("Some words were repeated. Pause briefly instead of restarting a phrase.")
    if pron and pron.get("available"):
        low = [w["word"] for w in pron.get("words", []) if w.get("score") is not None and w["score"] < 60]
        if low:
            tips.append("Practise these low-confidence words slowly: " + ", ".join(low[:6]) + ".")
    if not tips:
        tips.append("Great work - every word matched. Try a harder level or a faster pace.")
    return {"status": "ready", "source": "rule-based", "text": " ".join(tips), "tips": tips}


async def run_coaching_feedback(attempt_id: uuid.UUID, user_id: uuid.UUID, level: str, sid: str) -> None:
    ev = EventSession(user_id, f"{sid}-f")
    async with SessionLocal() as db:
        a = await db.get(PracticeAttempt, attempt_id)
        if a is None:
            return
        pron = attempt_detail(a).get("pronunciation")
        transcript = a.transcript.text if a.transcript else ""
        if not get_settings().groq_configured:
            a.feedback = _rule_based_reading_feedback(a.metrics, pron)
            await db.commit()
            await ev.emit("feedback.completed", {"attempt_id": str(attempt_id), "feedback": a.feedback})
            return
        co = DeltaCoalescer(ev, str(attempt_id))
        try:
            async for delta in feedback_engine.stream_coaching(a.exercise_type, level, a.reference_text, transcript, a.metrics, pron):
                await co.add(delta)
            await co.flush()
            text = "".join(co.full).strip()
            a.feedback = {"status": "ready", "source": "ai", "model": get_settings().groq_chat_model, "text": text,
                          "tips": _rule_based_reading_feedback(a.metrics, pron)["tips"]}
        except Exception as exc:  # network / API failures must not lose the attempt
            log.warning("Feedback generation failed: %s", exc)
            fb = _rule_based_reading_feedback(a.metrics, pron)
            fb["status"] = "ready"
            fb["ai_error"] = "AI feedback unavailable; showing rule-based tips."
            a.feedback = fb
            await ev.emit("error", {"attempt_id": str(attempt_id), "stage": "feedback", "message": "AI feedback failed; rule-based tips used."})
        await db.commit()
        await ev.emit("feedback.completed", {"attempt_id": str(attempt_id), "feedback": a.feedback})


async def _post_attempt(db, user_id: uuid.UUID) -> None:
    try:
        await update_progress_snapshot(db, user_id)
        await refresh_recommendations(db, user_id)
    except Exception:
        log.exception("progress/recommendation refresh failed")
        await db.rollback()


# ---------------------------------------------------------------- reading + tongue twister
@router.post("/assessments/reading", status_code=201)
async def assess_reading(
    background: BackgroundTasks,
    user: AIUser,
    db: DB,
    audio: UploadFile,
    exercise_id: Annotated[uuid.UUID, Form()],
    content_hash: Annotated[str, Form(max_length=64)],
    session_id: Annotated[str | None, Form()] = None,
    started_at_ms: Annotated[int | None, Form()] = None,
) -> dict:
    """Reading-aloud and tongue-twister assessment (exercise type decides which)."""
    ex = await get_visible_exercise(db, user, exercise_id)
    if ex.exercise_type not in ("reading", "tongue_twister"):
        raise HTTPException(400, "Exercise is not a reading or tongue twister exercise")
    if ex.content_hash != content_hash:
        raise HTTPException(409, "The exercise text changed after you started. Please restart the exercise.")
    reference = ex.content  # frozen reference for scoring
    sid = _sid(session_id)
    ev = EventSession(user.id, f"{sid}-a")
    dec = await _read_audio(audio)
    await ev.emit("assessment.started", {"exercise_id": str(ex.id), "stage": "transcribing"})

    # Transcription (no reference prompt: biasing Whisper with the reference would inflate accuracy).
    t = await _transcribe_or_http(dec)
    await ev.emit("transcript.final", {"text": t.text, "model": t.model})

    al = align_texts(reference, t.text, t.words or None)
    await ev.emit("assessment.progress", {"stage": "pronunciation", "word_accuracy": al.accuracy})
    pron = await asyncio.to_thread(assess_pronunciation, ctc_model, dec.samples, reference)

    window = _speaking_window_s(dec)
    metrics = {
        "reference_word_count": al.reference_word_count,
        "spoken_word_count": al.hypothesis_word_count,
        "correct": al.correct,
        "substitutions": al.substitutions,
        "deletions": al.deletions,
        "insertions": al.insertions,
        "repetitions": al.repetitions,
        "wer": al.wer,
        "accuracy": al.accuracy,
        "duration_s": round(dec.duration_s, 2),
        "reading_time_s": round(window, 2),
        "wpm": round(al.hypothesis_word_count / (window / 60), 1) if window > 1 else None,
        "mismatch_examples": [
            {"type": o.type, "expected": o.ref, "heard": o.hyp} for o in al.ops if o.type != "correct"
        ][:20],
        "transcription_backend": t.model,
        "empty_transcript": not t.text.strip(),
    }
    if ex.exercise_type == "tongue_twister":
        # Pace that only counts correctly spoken words, so speed never outranks intelligibility.
        metrics["clear_words_per_minute"] = round(al.correct / (window / 60), 1) if window > 1 else None
        metrics["pace_rated"] = bool(al.accuracy is not None and al.accuracy >= 80)

    started, ended = _started_at(started_at_ms, dec.duration_s)
    a = PracticeAttempt(
        user_id=user.id, exercise_id=ex.id, exercise_type=ex.exercise_type, difficulty=ex.difficulty,
        reference_text=reference, status="completed", started_at=started, ended_at=ended,
        duration_ms=int(dec.duration_s * 1000), word_accuracy=al.accuracy,
        pronunciation_score=pron.overall_score if pron.available else None,
        metrics=metrics, feedback={"status": "pending"},
        ai_metadata={"transcription": {"model": t.model, "latency_ms": t.latency_ms},
                     "pronunciation": {"model": pron.model, "method": pron.method}},
    )
    a.transcript = SpeechTranscript(text=t.text, words=t.words, model=t.model, language=t.language,
                                    audio_duration_s=dec.duration_s, latency_ms=t.latency_ms)
    a.alignment = WordAlignment(
        ops=[o.__dict__ for o in al.ops], reference_word_count=al.reference_word_count, correct=al.correct,
        substitutions=al.substitutions, deletions=al.deletions, insertions=al.insertions,
        repetitions=al.repetitions, wer=al.wer)
    pd = pron.to_dict()
    a.pronunciation = PronunciationAssessment(available=pron.available, unavailable_reason=pron.unavailable_reason,
                                              model=pron.model, method=pron.method, overall_score=pron.overall_score,
                                              words=pd["words"])
    db.add(a)
    await db.commit()
    await db.refresh(a)
    await _post_attempt(db, user.id)
    await ev.emit("assessment.completed", {"attempt_id": str(a.id), "word_accuracy": al.accuracy})
    level = user.profile.proficiency_level if user.profile else "intermediate"
    background.add_task(run_coaching_feedback, a.id, user.id, level, sid)
    return {"attempt": attempt_detail(a), "session_id": sid}


# ---------------------------------------------------------------- pronunciation
@router.post("/assessments/pronunciation", status_code=201)
async def assess_pron(
    background: BackgroundTasks,
    user: AIUser,
    db: DB,
    audio: UploadFile,
    exercise_id: Annotated[uuid.UUID | None, Form()] = None,
    content_hash: Annotated[str | None, Form(max_length=64)] = None,
    custom_text: Annotated[str | None, Form(max_length=300)] = None,
    session_id: Annotated[str | None, Form()] = None,
    started_at_ms: Annotated[int | None, Form()] = None,
) -> dict:
    if exercise_id:
        ex = await get_visible_exercise(db, user, exercise_id)
        if content_hash and ex.content_hash != content_hash:
            raise HTTPException(409, "The exercise text changed after you started. Please restart.")
        reference, ex_id, diff = ex.content, ex.id, ex.difficulty
    else:
        reference = " ".join((custom_text or "").split())
        words = reference.split()
        if not (1 <= len(words) <= 40) or not re.fullmatch(r"[A-Za-z0-9' ,.!?;:\-’]+", reference):
            raise HTTPException(422, "Custom text must be 1-40 English words using letters and basic punctuation")
        ex_id, diff = None, None
    sid = _sid(session_id)
    ev = EventSession(user.id, f"{sid}-a")
    dec = await _read_audio(audio, min_seconds=0.3)
    await ev.emit("assessment.started", {"stage": "pronunciation"})

    pron = await asyncio.to_thread(assess_pronunciation, ctc_model, dec.samples, reference)
    # Transcription is shown separately as a *different* metric (word matching), never as pronunciation.
    try:
        t = await stt.transcribe(dec)
        al = align_texts(reference, t.text, t.words or None)
    except Exception as exc:
        log.info("Transcription unavailable for pronunciation attempt: %s", exc)
        t, al = None, None
    started, ended = _started_at(started_at_ms, dec.duration_s)
    metrics = {"duration_s": round(dec.duration_s, 2), "reference_word_count": len(reference.split()),
               "accuracy": al.accuracy if al else None,
               "mismatch_examples": [{"type": o.type, "expected": o.ref, "heard": o.hyp} for o in al.ops if o.type != "correct"][:20] if al else [],
               "substitutions": al.substitutions if al else None, "deletions": al.deletions if al else None,
               "insertions": al.insertions if al else None, "repetitions": al.repetitions if al else None,
               "correct": al.correct if al else None}
    a = PracticeAttempt(
        user_id=user.id, exercise_id=ex_id, exercise_type="pronunciation", difficulty=diff, reference_text=reference,
        status="completed", started_at=started, ended_at=ended, duration_ms=int(dec.duration_s * 1000),
        word_accuracy=al.accuracy if al else None,
        pronunciation_score=pron.overall_score if pron.available else None,
        metrics=metrics, feedback={"status": "pending"},
        ai_metadata={"pronunciation": {"model": pron.model, "method": pron.method},
                     **({"transcription": {"model": t.model, "latency_ms": t.latency_ms}} if t else {})},
    )
    pd = pron.to_dict()
    a.pronunciation = PronunciationAssessment(available=pron.available, unavailable_reason=pron.unavailable_reason,
                                              model=pron.model, method=pron.method, overall_score=pron.overall_score, words=pd["words"])
    if t:
        a.transcript = SpeechTranscript(text=t.text, words=t.words, model=t.model, language=t.language,
                                        audio_duration_s=dec.duration_s, latency_ms=t.latency_ms)
    if al:
        a.alignment = WordAlignment(ops=[o.__dict__ for o in al.ops], reference_word_count=al.reference_word_count,
                                    correct=al.correct, substitutions=al.substitutions, deletions=al.deletions,
                                    insertions=al.insertions, repetitions=al.repetitions, wer=al.wer)
    db.add(a)
    await db.commit()
    await db.refresh(a)
    await _post_attempt(db, user.id)
    await ev.emit("assessment.completed", {"attempt_id": str(a.id)})
    level = user.profile.proficiency_level if user.profile else "intermediate"
    background.add_task(run_coaching_feedback, a.id, user.id, level, sid)
    return {"attempt": attempt_detail(a), "session_id": sid}


# ---------------------------------------------------------------- speaking
def _acoustic_to_estimate(score: float | None) -> float | None:
    """Transparent heuristic: 0-100 acoustic confidence -> 0-9 practice estimate."""
    if score is None:
        return None
    return round(max(0.0, min(9.0, score / 100 * 9)) * 2) / 2


async def run_speaking_feedback(attempt_id: uuid.UUID, user_id: uuid.UUID, level: str, sid: str) -> None:
    ev = EventSession(user_id, f"{sid}-f")
    async with SessionLocal() as db:
        a = await db.get(PracticeAttempt, attempt_id)
        if a is None or a.speaking is None:
            return
        sp = a.speaking
        transcript = a.transcript.text if a.transcript else ""
        estimates = dict(sp.estimates)
        if not get_settings().groq_configured:
            a.feedback = {"status": "unavailable", "source": "none",
                          "text": "Grammar, vocabulary and coherence feedback needs the Groq API (GROQ_API_KEY). Fluency and pronunciation measurements are shown."}
        elif len(transcript.split()) < 5:
            a.feedback = {"status": "ready", "source": "rule-based",
                          "text": "The recording contained too little recognizable speech to analyse grammar and vocabulary. Try speaking for longer."}
        else:
            await ev.emit("assessment.progress", {"attempt_id": str(attempt_id), "stage": "language_analysis"})
            try:
                data, meta = await feedback_engine.speaking_language_feedback(
                    sp.question, sp.part, transcript, level,
                    {"word_count": sp.fluency.get("word_count"), "speech_rate_wpm": sp.fluency.get("speech_rate_wpm")})
                sp.language = data
                for k in ("grammar", "vocabulary", "coherence"):
                    estimates[k] = data[k]["estimate"]
                a.feedback = {"status": "ready", "source": "ai", "model": meta.get("model"), "language": data,
                              "text": " ".join([data["grammar"]["summary"], data["vocabulary"]["summary"], data["coherence"]["summary"]])}
                a.ai_metadata = {**(a.ai_metadata or {}), "feedback": {"model": meta.get("model"), "latency_ms": meta.get("latency_ms")}}
            except Exception as exc:
                log.warning("Speaking feedback failed: %s", exc)
                a.feedback = {"status": "failed", "source": "ai", "text": "AI language feedback failed. You can retry from the results page."}
                await ev.emit("error", {"attempt_id": str(attempt_id), "stage": "feedback", "message": "AI language feedback failed"})
        vals = [v for v in estimates.values() if v is not None]
        estimates["overall"] = round(sum(vals) / len(vals) * 2) / 2 if vals else None
        sp.estimates = estimates
        a.metrics = {**(a.metrics or {}), "speaking_overall_estimate": estimates.get("overall")}
        await db.commit()
        await update_progress_snapshot(db, user_id)
        await ev.emit("feedback.completed", {"attempt_id": str(attempt_id), "feedback": a.feedback, "estimates": estimates})


@router.post("/assessments/speaking", status_code=201)
async def assess_speaking(
    background: BackgroundTasks,
    user: AIUser,
    db: DB,
    audio: UploadFile,
    exercise_id: Annotated[uuid.UUID, Form()],
    session_id: Annotated[str | None, Form()] = None,
    started_at_ms: Annotated[int | None, Form()] = None,
) -> dict:
    ex = await get_visible_exercise(db, user, exercise_id)
    if ex.exercise_type != "speaking":
        raise HTTPException(400, "Exercise is not a speaking exercise")
    sid = _sid(session_id)
    ev = EventSession(user.id, f"{sid}-a")
    dec = await _read_audio(audio, min_seconds=1.0)
    await ev.emit("assessment.started", {"stage": "transcribing"})
    t = await _transcribe_or_http(dec)
    await ev.emit("transcript.final", {"text": t.text, "model": t.model})
    fl = compute_fluency(dec.samples, dec.sample_rate, t.text, t.words)
    # Acoustic clarity: force-align the recognized words; measures how clearly the audio supports them.
    pron = await asyncio.to_thread(assess_pronunciation, ctc_model, dec.samples, t.text) if t.text.strip() else None
    pron_block = {
        "available": bool(pron and pron.available),
        "overall_score": pron.overall_score if pron and pron.available else None,
        "low_confidence_words": [w.word for w in (pron.words if pron and pron.available else []) if w.score is not None and w.score < 60][:12],
        "method": "Acoustic clarity of the recognized words (CTC forced alignment, word-level). Not phoneme-level.",
        "unavailable_reason": None if pron and pron.available else (pron.unavailable_reason if pron else "No speech recognized"),
    }
    estimates = {
        "fluency": fluency_estimate(fl),
        "pronunciation": _acoustic_to_estimate(pron_block["overall_score"]),
        "grammar": None, "vocabulary": None, "coherence": None,
    }
    part = int(ex.details.get("part", 1))
    started, ended = _started_at(started_at_ms, dec.duration_s)
    a = PracticeAttempt(
        user_id=user.id, exercise_id=ex.id, exercise_type="speaking", difficulty=ex.difficulty, reference_text=ex.content,
        status="completed", started_at=started, ended_at=ended, duration_ms=int(dec.duration_s * 1000),
        pronunciation_score=pron_block["overall_score"],
        metrics={"duration_s": round(dec.duration_s, 2), "word_count": fl["word_count"], "speaking_overall_estimate": None,
                 "target_speak_seconds": ex.details.get("speak_seconds")},
        feedback={"status": "pending"},
        ai_metadata={"transcription": {"model": t.model, "latency_ms": t.latency_ms}},
    )
    a.transcript = SpeechTranscript(text=t.text, words=t.words, model=t.model, language=t.language,
                                    audio_duration_s=dec.duration_s, latency_ms=t.latency_ms)
    a.speaking = SpeakingAssessment(part=part, question=ex.content, fluency=fl, pronunciation=pron_block, language={},
                                    estimates=estimates,
                                    notes="Practice estimates on a 0-9 scale. Not official IELTS band scores.")
    if pron is not None:
        a.pronunciation = PronunciationAssessment(available=pron.available, unavailable_reason=pron.unavailable_reason,
                                                  model=pron.model, method=pron.method, overall_score=pron.overall_score,
                                                  words=pron.to_dict()["words"])
    db.add(a)
    await db.commit()
    await db.refresh(a)
    await _post_attempt(db, user.id)
    await ev.emit("assessment.completed", {"attempt_id": str(a.id)})
    level = user.profile.proficiency_level if user.profile else "intermediate"
    background.add_task(run_speaking_feedback, a.id, user.id, level, sid)
    return {"attempt": attempt_detail(a), "session_id": sid}


# ---------------------------------------------------------------- typing
class TypingIn(BaseModel):
    exercise_id: uuid.UUID
    content_hash: str = Field(max_length=64)
    mode: Literal["practice", "challenge"]
    typed_text: str = Field(max_length=5000)
    elapsed_ms: int = Field(gt=0, le=60 * 60 * 1000)
    total_keystrokes: int = Field(ge=0, le=100000)
    corrected_errors: int = Field(ge=0, le=100000)
    started_at_ms: int | None = None


@router.post("/assessments/typing", status_code=201)
async def assess_typing(body: TypingIn, user: CurrentUser, db: DB) -> dict:
    ex = await get_visible_exercise(db, user, body.exercise_id)
    if ex.content_hash != body.content_hash:
        raise HTTPException(409, "The exercise text changed after you started. Please restart.")
    reference = ex.content
    try:
        m = compute_typing_metrics(reference, body.typed_text, body.elapsed_ms, body.total_keystrokes,
                                   body.corrected_errors, body.mode)
    except TypingValidationError as exc:
        raise HTTPException(422, str(exc))
    started, ended = _started_at(body.started_at_ms, body.elapsed_ms / 1000)
    tips = typing_tips(m)
    a = PracticeAttempt(
        user_id=user.id, exercise_id=ex.id, exercise_type="typing", difficulty=ex.difficulty, reference_text=reference,
        status="completed", started_at=started, ended_at=ended, duration_ms=body.elapsed_ms,
        typing_wpm=m.net_wpm, typing_accuracy=m.accuracy,
        metrics={**m.to_dict(), "mode": body.mode},
        feedback={"status": "ready", "source": "rule-based", "text": " ".join(tips), "tips": tips},
        ai_metadata={},
    )
    a.typing = TypingResult(mode=body.mode, gross_wpm=m.gross_wpm, net_wpm=m.net_wpm, accuracy=m.accuracy,
                            correct_chars=m.correct_chars, incorrect_chars=m.incorrect_chars,
                            corrected_errors=m.corrected_errors, uncorrected_errors=m.uncorrected_errors,
                            total_keystrokes=m.total_keystrokes, typed_chars=m.typed_chars, elapsed_ms=m.elapsed_ms,
                            error_rate=m.error_rate, completed=m.completed, typed_text=body.typed_text)
    db.add(a)
    await db.commit()
    await db.refresh(a)
    await _post_attempt(db, user.id)
    return {"attempt": attempt_detail(a)}
