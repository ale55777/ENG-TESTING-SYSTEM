from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response
from sqlalchemy import delete, func, select

from app.core.deps import DB, AIUser, CurrentUser
from app.models import LearningRecommendation, PracticeAttempt, ProgressSnapshot, Report
from app.services.recommendations.engine import refresh_recommendations
from app.services.reports import export
from app.services.scoring.attempts import attempt_detail, attempt_summary, update_progress_snapshot

router = APIRouter(tags=["history"])
TYPES = ("reading", "tongue_twister", "pronunciation", "speaking", "typing")


async def _own_attempt(db, user, attempt_id: uuid.UUID) -> PracticeAttempt:
    a = await db.scalar(select(PracticeAttempt).where(PracticeAttempt.id == attempt_id, PracticeAttempt.user_id == user.id))
    if not a:
        raise HTTPException(404, "Attempt not found")
    return a


@router.get("/attempts")
async def list_attempts(
    user: CurrentUser, db: DB,
    exercise_type: str | None = Query(None, alias="type"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    q = select(PracticeAttempt).where(PracticeAttempt.user_id == user.id)
    cq = select(func.count()).select_from(PracticeAttempt).where(PracticeAttempt.user_id == user.id)
    if exercise_type:
        if exercise_type not in TYPES:
            raise HTTPException(400, "Unknown exercise type")
        q = q.where(PracticeAttempt.exercise_type == exercise_type)
        cq = cq.where(PracticeAttempt.exercise_type == exercise_type)
    total = await db.scalar(cq)
    rows = (await db.scalars(q.order_by(PracticeAttempt.created_at.desc()).limit(limit).offset(offset))).all()
    return {"items": [attempt_summary(a) for a in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/attempts/{attempt_id}")
async def get_attempt(attempt_id: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    return {"attempt": attempt_detail(await _own_attempt(db, user, attempt_id))}


@router.delete("/attempts/{attempt_id}")
async def delete_attempt(attempt_id: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    a = await _own_attempt(db, user, attempt_id)
    day = a.created_at.date() if a.created_at else None
    await db.delete(a)
    await db.commit()
    await update_progress_snapshot(db, user.id, day)
    return {"ok": True}


@router.post("/attempts/{attempt_id}/feedback")
async def retry_feedback(attempt_id: uuid.UUID, background: BackgroundTasks, user: AIUser, db: DB) -> dict:
    """Re-run AI feedback for an attempt (e.g. after a network failure)."""
    from app.api.v1.assessments import run_coaching_feedback, run_speaking_feedback

    a = await _own_attempt(db, user, attempt_id)
    if a.exercise_type == "typing":
        raise HTTPException(400, "Typing results use deterministic tips only")
    a.feedback = {"status": "pending"}
    await db.commit()
    sid = uuid.uuid4().hex
    level = user.profile.proficiency_level if user.profile else "intermediate"
    task = run_speaking_feedback if a.exercise_type == "speaking" else run_coaching_feedback
    background.add_task(task, a.id, user.id, level, sid)
    return {"ok": True, "session_id": sid}


# ---------------------------------------------------------------- progress
@router.get("/progress/summary")
async def progress_summary(user: CurrentUser, db: DB) -> dict:
    base = select(PracticeAttempt).where(PracticeAttempt.user_id == user.id, PracticeAttempt.status == "completed")
    rows = (await db.scalars(base.order_by(PracticeAttempt.created_at.desc()))).all()

    def avg(vals):
        v = [x for x in vals if x is not None]
        return round(sum(v) / len(v), 1) if v else None

    by_type = {t: [a for a in rows if a.exercise_type == t] for t in TYPES}
    best_wpm = max((a.typing_wpm for a in by_type["typing"] if a.typing_wpm is not None), default=None)
    days = sorted({a.created_at.date() for a in rows}, reverse=True)
    streak = 0
    today = datetime.now(timezone.utc).date()
    cur = today if days and days[0] == today else today - timedelta(days=1)
    for d in days:
        if d == cur:
            streak += 1
            cur -= timedelta(days=1)
        elif d < cur:
            break
    return {
        "total_sessions": len(rows),
        "total_practice_minutes": round(sum(a.duration_ms for a in rows) / 60000, 1),
        "streak_days": streak,
        "counts": {t: len(v) for t, v in by_type.items()},
        "reading_accuracy_avg": avg([a.word_accuracy for a in by_type["reading"]]),
        "twister_accuracy_avg": avg([a.word_accuracy for a in by_type["tongue_twister"]]),
        "pronunciation_score_avg": avg([a.pronunciation_score for a in rows if a.exercise_type in ("pronunciation", "reading", "tongue_twister")]),
        "speaking_estimate_avg": avg([(a.metrics or {}).get("speaking_overall_estimate") for a in by_type["speaking"]]),
        "typing_wpm_avg": avg([a.typing_wpm for a in by_type["typing"]]),
        "typing_wpm_best": best_wpm,
        "typing_accuracy_avg": avg([a.typing_accuracy for a in by_type["typing"]]),
        "recent": [attempt_summary(a) for a in rows[:8]],
    }


@router.get("/progress/timeseries")
async def progress_timeseries(user: CurrentUser, db: DB, days: int = Query(30, ge=7, le=365)) -> dict:
    since = datetime.now(timezone.utc).date() - timedelta(days=days)
    snaps = (await db.scalars(select(ProgressSnapshot).where(
        ProgressSnapshot.user_id == user.id, ProgressSnapshot.day >= since).order_by(ProgressSnapshot.day))).all()
    return {"points": [{"day": s.day.isoformat(), **s.metrics} for s in snaps]}


@router.get("/progress/trends")
async def progress_trends(user: CurrentUser, db: DB, limit: int = Query(30, ge=5, le=200)) -> dict:
    """Per-attempt score series per module (for charts)."""
    rows = (await db.scalars(select(PracticeAttempt).where(PracticeAttempt.user_id == user.id, PracticeAttempt.status == "completed")
                             .order_by(PracticeAttempt.created_at.desc()).limit(limit * 5))).all()
    out: dict[str, list] = {t: [] for t in TYPES}
    for a in reversed(rows):
        p = {"at": a.created_at.isoformat(), "id": str(a.id)}
        if a.exercise_type == "typing":
            p |= {"wpm": a.typing_wpm, "accuracy": a.typing_accuracy}
        elif a.exercise_type == "speaking":
            p |= {"overall": (a.metrics or {}).get("speaking_overall_estimate"),
                  **({k: v for k, v in a.speaking.estimates.items() if k != "overall"} if a.speaking else {})}
        else:
            p |= {"accuracy": a.word_accuracy, "pronunciation": a.pronunciation_score}
        out[a.exercise_type].append(p)
    return {k: v[-limit:] for k, v in out.items()}


@router.get("/recommendations")
async def recommendations(user: CurrentUser, db: DB) -> dict:
    rows = (await db.scalars(select(LearningRecommendation).where(
        LearningRecommendation.user_id == user.id, LearningRecommendation.dismissed.is_(False))
        .order_by(LearningRecommendation.priority.desc()))).all()
    if not rows:
        rows = await refresh_recommendations(db, user.id)
    return {"items": [{"id": str(r.id), "kind": r.kind, "title": r.title, "reason": r.reason, "target": r.target} for r in rows]}


@router.post("/recommendations/{rec_id}/dismiss")
async def dismiss_recommendation(rec_id: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    r = await db.scalar(select(LearningRecommendation).where(LearningRecommendation.id == rec_id, LearningRecommendation.user_id == user.id))
    if not r:
        raise HTTPException(404, "Not found")
    r.dismissed = True
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- reports
@router.get("/reports/attempts/{attempt_id}")
async def export_report(attempt_id: uuid.UUID, user: CurrentUser, db: DB, format: str = Query("pdf", pattern="^(pdf|json|txt)$")) -> Response:
    a = await _own_attempt(db, user, attempt_id)
    recs = (await db.scalars(select(LearningRecommendation).where(
        LearningRecommendation.user_id == user.id, LearningRecommendation.dismissed.is_(False))
        .order_by(LearningRecommendation.priority.desc()).limit(4))).all()
    name = user.profile.display_name if user.profile else user.email
    rep = export.build_report(name, attempt_detail(a), [{"title": r.title, "reason": r.reason} for r in recs])
    if format == "json":
        body, mt = export.to_json(rep), "application/json"
    elif format == "txt":
        body, mt = export.to_txt(rep), "text/plain; charset=utf-8"
    else:
        import asyncio

        body, mt = await asyncio.to_thread(export.to_pdf, rep), "application/pdf"
    db.add(Report(user_id=user.id, attempt_id=a.id, format=format))
    await db.commit()
    fname = f"practice-report-{a.exercise_type}-{a.created_at:%Y%m%d-%H%M}.{format}"
    return Response(body, media_type=mt, headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.delete("/attempts")
async def delete_all_attempts(user: CurrentUser, db: DB) -> dict:
    res = await db.execute(delete(PracticeAttempt).where(PracticeAttempt.user_id == user.id))
    await db.execute(delete(ProgressSnapshot).where(ProgressSnapshot.user_id == user.id))
    await db.commit()
    return {"deleted": res.rowcount or 0}
