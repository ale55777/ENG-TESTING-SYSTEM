"""Attempt persistence, serialization and daily progress snapshots."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PracticeAttempt, ProgressSnapshot

DISCLAIMER = (
    "Practice estimate only. Scores are produced by automatic speech recognition, an acoustic model and "
    "deterministic algorithms; recognition errors can affect results. This is not an official language "
    "test score or certification (including IELTS)."
)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def attempt_summary(a: PracticeAttempt) -> dict:
    return {
        "id": str(a.id),
        "exercise_id": str(a.exercise_id) if a.exercise_id else None,
        "exercise_type": a.exercise_type,
        "difficulty": a.difficulty,
        "reference_preview": a.reference_text[:140],
        "status": a.status,
        "started_at": iso(a.started_at),
        "ended_at": iso(a.ended_at),
        "duration_ms": a.duration_ms,
        "word_accuracy": a.word_accuracy,
        "pronunciation_score": a.pronunciation_score,
        "typing_wpm": a.typing_wpm,
        "typing_accuracy": a.typing_accuracy,
        "speaking_overall": (a.metrics or {}).get("speaking_overall_estimate"),
        "feedback_status": (a.feedback or {}).get("status", "none"),
        "created_at": iso(a.created_at),
    }


def attempt_detail(a: PracticeAttempt) -> dict:
    d = attempt_summary(a)
    d.update({
        "reference_text": a.reference_text,
        "metrics": a.metrics or {},
        "feedback": a.feedback,
        "ai_metadata": a.ai_metadata or {},
        "disclaimer": DISCLAIMER,
        "transcript": None,
        "alignment": None,
        "pronunciation": None,
        "typing": None,
        "speaking": None,
    })
    if a.transcript:
        t = a.transcript
        d["transcript"] = {"text": t.text, "words": t.words, "model": t.model, "language": t.language,
                           "audio_duration_s": t.audio_duration_s, "latency_ms": t.latency_ms}
    if a.alignment:
        al = a.alignment
        d["alignment"] = {"ops": al.ops, "reference_word_count": al.reference_word_count, "correct": al.correct,
                          "substitutions": al.substitutions, "deletions": al.deletions, "insertions": al.insertions,
                          "repetitions": al.repetitions, "wer": al.wer}
    if a.pronunciation:
        p = a.pronunciation
        d["pronunciation"] = {"available": p.available, "unavailable_reason": p.unavailable_reason, "model": p.model,
                              "method": p.method, "overall_score": p.overall_score, "words": p.words}
    if a.typing:
        ty = a.typing
        d["typing"] = {k: getattr(ty, k) for k in (
            "mode", "gross_wpm", "net_wpm", "accuracy", "correct_chars", "incorrect_chars", "corrected_errors",
            "uncorrected_errors", "total_keystrokes", "typed_chars", "elapsed_ms", "error_rate", "completed", "typed_text")}
    if a.speaking:
        sp = a.speaking
        d["speaking"] = {"part": sp.part, "question": sp.question, "fluency": sp.fluency,
                         "pronunciation": sp.pronunciation, "language": sp.language, "estimates": sp.estimates,
                         "notes": sp.notes}
    return d


def _avg(vals: list[float | None]) -> float | None:
    v = [x for x in vals if x is not None]
    return round(sum(v) / len(v), 2) if v else None


async def update_progress_snapshot(db: AsyncSession, user_id: uuid.UUID, day: date | None = None) -> None:
    day = day or datetime.now(timezone.utc).date()
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    rows = (await db.scalars(
        select(PracticeAttempt).where(
            PracticeAttempt.user_id == user_id,
            PracticeAttempt.created_at >= start,
            PracticeAttempt.created_at < end,
            PracticeAttempt.status == "completed",
        )
    )).all()
    metrics = {
        "sessions": len(rows),
        "practice_minutes": round(sum(r.duration_ms for r in rows) / 60000, 1),
        "reading_accuracy": _avg([r.word_accuracy for r in rows if r.exercise_type == "reading"]),
        "twister_accuracy": _avg([r.word_accuracy for r in rows if r.exercise_type == "tongue_twister"]),
        "pronunciation_score": _avg([r.pronunciation_score for r in rows]),
        "typing_wpm": _avg([r.typing_wpm for r in rows]),
        "typing_accuracy": _avg([r.typing_accuracy for r in rows]),
        "speaking_estimate": _avg([(r.metrics or {}).get("speaking_overall_estimate") for r in rows if r.exercise_type == "speaking"]),
    }
    snap = await db.scalar(select(ProgressSnapshot).where(ProgressSnapshot.user_id == user_id, ProgressSnapshot.day == day))
    if snap is None:
        if not rows:
            return
        db.add(ProgressSnapshot(user_id=user_id, day=day, metrics=metrics))
    else:
        snap.metrics = metrics
    await db.commit()
