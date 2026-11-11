"""Deterministic personalised recommendations derived only from the learner's saved attempts.

Each recommendation states the measured evidence it is based on. No claims about overall
proficiency are made.
"""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LearningRecommendation, PracticeAttempt

MODULES = {
    "reading": "Reading aloud",
    "pronunciation": "Pronunciation drills",
    "tongue_twister": "Tongue twisters",
    "speaking": "Speaking practice",
    "typing": "Typing practice",
}


def build_recommendations(attempts: list[PracticeAttempt], now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    recs: list[dict] = []
    if not attempts:
        return [{
            "kind": "reading", "priority": 100, "title": "Start with a reading-aloud exercise",
            "reason": "You have no practice history yet. A short reading exercise gives a first measurement.",
            "target": {"path": "/practice/reading"},
        }]

    missed = Counter()
    low_pron = Counter()
    for a in attempts:
        if a.alignment and a.exercise_type in ("reading", "tongue_twister", "pronunciation"):
            for op in a.alignment.ops:
                if op.get("type") in ("deletion", "substitution") and op.get("ref"):
                    missed[op["ref"]] += 1
        if a.pronunciation and a.pronunciation.available:
            for w in a.pronunciation.words:
                if w.get("score") is not None and w["score"] < 60:
                    low_pron[w["word"].lower()] += 1

    repeat_missed = [w for w, c in missed.most_common(8) if c >= 2 and len(w) > 2]
    if repeat_missed:
        recs.append({
            "kind": "reading", "priority": 90,
            "title": "Re-read passages containing words you often miss",
            "reason": f"These words were missed or substituted at least twice: {', '.join(repeat_missed[:5])}.",
            "target": {"path": "/practice/reading", "words": repeat_missed[:5]},
        })
    weak_words = [w for w, _ in low_pron.most_common(6)]
    if weak_words:
        recs.append({
            "kind": "pronunciation", "priority": 85,
            "title": "Drill your low-confidence words",
            "reason": f"The acoustic model found weak evidence for: {', '.join(weak_words[:5])}.",
            "target": {"path": "/practice/pronunciation", "custom_text": " ".join(weak_words[:6])},
        })

    tw = [a for a in attempts if a.exercise_type == "tongue_twister" and a.word_accuracy is not None]
    if tw:
        avg = sum(a.word_accuracy for a in tw[:5]) / len(tw[:5])
        if avg < 80:
            recs.append({"kind": "tongue_twister", "priority": 70, "title": "Slow down on tongue twisters",
                         "reason": f"Your recent tongue-twister word accuracy averages {avg:.0f}%. Clarity first, speed later.",
                         "target": {"path": "/practice/tongue-twisters", "difficulty": "beginner"}})
        elif avg >= 95 and len(tw) >= 3:
            recs.append({"kind": "tongue_twister", "priority": 40, "title": "Try a harder tongue twister",
                         "reason": f"Your recent tongue-twister accuracy averages {avg:.0f}%.",
                         "target": {"path": "/practice/tongue-twisters", "difficulty": "advanced"}})

    ty = [a for a in attempts if a.exercise_type == "typing" and a.typing_accuracy is not None]
    if ty:
        acc = sum(a.typing_accuracy for a in ty[:5]) / len(ty[:5])
        wpm = sum(a.typing_wpm or 0 for a in ty[:5]) / len(ty[:5])
        if acc < 92:
            recs.append({"kind": "typing", "priority": 65, "title": "Focus on typing accuracy",
                         "reason": f"Recent typing accuracy averages {acc:.1f}% (net {wpm:.0f} WPM). Use Practice mode and slow down.",
                         "target": {"path": "/practice/typing", "mode": "practice"}})
        elif acc >= 97:
            recs.append({"kind": "typing", "priority": 35, "title": "Take the strict Challenge mode",
                         "reason": f"Recent typing accuracy averages {acc:.1f}%. Challenge mode tests accuracy without corrections.",
                         "target": {"path": "/practice/typing", "mode": "challenge"}})

    sp = [a for a in attempts if a.exercise_type == "speaking" and a.speaking]
    if sp:
        g = [a.speaking.estimates.get("grammar") for a in sp[:5] if a.speaking.estimates.get("grammar") is not None]
        if g and sum(g) / len(g) < 6:
            recs.append({"kind": "speaking", "priority": 60, "title": "Practise Part 1 answers focusing on grammar",
                         "reason": f"Your recent grammar practice estimate averages {sum(g)/len(g):.1f}/9. Review the corrections in your last attempts.",
                         "target": {"path": "/practice/speaking", "part": 1}})
        fl = [a.speaking.fluency.get("long_pause_count", 0) for a in sp[:5]]
        if fl and sum(fl) / len(fl) >= 3:
            recs.append({"kind": "speaking", "priority": 55, "title": "Reduce long pauses",
                         "reason": f"Your recent answers had on average {sum(fl)/len(fl):.1f} pauses longer than 1.5 seconds.",
                         "target": {"path": "/practice/speaking", "part": 2}})

    tried = {a.exercise_type for a in attempts}
    for kind, label in MODULES.items():
        if kind not in tried:
            recs.append({"kind": kind, "priority": 30, "title": f"Try {label}",
                         "reason": "You have not tried this module yet.",
                         "target": {"path": {"tongue_twister": "/practice/tongue-twisters"}.get(kind, f"/practice/{kind}")}})

    latest = max(a.created_at for a in attempts)
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    if now - latest > timedelta(days=3):
        recs.append({"kind": "reading", "priority": 95, "title": "Welcome back - a quick warm-up",
                     "reason": f"Your last practice was {(now - latest).days} days ago.",
                     "target": {"path": "/practice/reading"}})

    recs.sort(key=lambda r: -r["priority"])
    return recs[:6]


async def refresh_recommendations(db: AsyncSession, user_id: uuid.UUID) -> list[LearningRecommendation]:
    attempts = (await db.scalars(
        select(PracticeAttempt).where(PracticeAttempt.user_id == user_id, PracticeAttempt.status == "completed")
        .order_by(PracticeAttempt.created_at.desc()).limit(40)
    )).all()
    recs = build_recommendations(list(attempts))
    await db.execute(delete(LearningRecommendation).where(
        LearningRecommendation.user_id == user_id, LearningRecommendation.dismissed.is_(False)))
    rows = [LearningRecommendation(user_id=user_id, **r) for r in recs]
    db.add_all(rows)
    await db.commit()
    return rows
