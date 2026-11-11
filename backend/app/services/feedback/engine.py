"""AI feedback engine (Groq GPT-OSS).

Rules enforced here:
  * Deterministic numbers (word counts, WER, timings, typing metrics, acoustic scores) are computed
    elsewhere and passed to the LLM as read-only context. LLM output is stored separately under
    `attempt.feedback` and can never overwrite `attempt.metrics`.
  * Explanations are adapted to the learner's proficiency level.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

from app.services.groq.client import groq_client

LEVEL_STYLE = {
    "beginner": "Use very simple English (A2), short sentences, and no linguistic jargon.",
    "intermediate": "Use clear B1-B2 English; brief grammar terms are fine if explained.",
    "advanced": "Use precise C1 English; you may use standard linguistic terminology.",
}

COACH_SYSTEM = (
    "You are a supportive English pronunciation and reading coach. You receive MEASURED results from "
    "deterministic algorithms and an acoustic model. Never invent or change any numbers, never claim "
    "certification-level accuracy, and never say a word was mispronounced unless the measurements say so. "
    "Note that speech recognition can make mistakes. Write plain text (no markdown headings, no tables), "
    "max 170 words: 1) one sentence of encouragement grounded in the data, 2) up to 3 specific things to "
    "practise with concrete tips (e.g. mouth position, stress, linking), 3) one suggested next exercise."
)


def _compact_reading_context(kind: str, reference: str, transcript: str, metrics: dict, pron: dict | None) -> str:
    ctx = {
        "exercise_type": kind,
        "reference_text": reference,
        "recognized_transcript": transcript,
        "word_matching": {k: metrics.get(k) for k in (
            "reference_word_count", "correct", "substitutions", "deletions", "insertions", "repetitions", "accuracy")},
        "mismatches": metrics.get("mismatch_examples", [])[:12],
        "duration_seconds": metrics.get("duration_s"),
        "words_per_minute": metrics.get("wpm"),
    }
    if pron and pron.get("available"):
        ctx["acoustic_word_confidence"] = {
            "overall": pron.get("overall_score"),
            "low_confidence_words": [
                {"word": w["word"], "score": w["score"], "model_heard": w.get("heard")}
                for w in pron.get("words", []) if w.get("score") is not None and w["score"] < 75
            ][:10],
            "method_note": "character-level CTC forced alignment; not phoneme-level",
        }
    else:
        ctx["acoustic_word_confidence"] = "unavailable"
    return json.dumps(ctx, ensure_ascii=False)


async def stream_coaching(kind: str, level: str, reference: str, transcript: str, metrics: dict, pron: dict | None) -> AsyncIterator[str]:
    messages = [
        {"role": "system", "content": COACH_SYSTEM + " " + LEVEL_STYLE.get(level, LEVEL_STYLE["intermediate"])},
        {"role": "user", "content": "Measured results (JSON):\n" + _compact_reading_context(kind, reference, transcript, metrics, pron)},
    ]
    async for delta in groq_client.chat_stream(messages):
        yield delta


SPEAKING_SCHEMA = {
    "type": "object",
    "properties": {
        "grammar": {
            "type": "object",
            "properties": {
                "estimate": {"type": "number"},
                "summary": {"type": "string"},
                "issues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "original": {"type": "string"},
                            "correction": {"type": "string"},
                            "explanation": {"type": "string"},
                        },
                        "required": ["original", "correction", "explanation"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["estimate", "summary", "issues"],
            "additionalProperties": False,
        },
        "vocabulary": {
            "type": "object",
            "properties": {
                "estimate": {"type": "number"},
                "summary": {"type": "string"},
                "suggestions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "used": {"type": "string"},
                            "better_alternatives": {"type": "array", "items": {"type": "string"}},
                            "why": {"type": "string"},
                        },
                        "required": ["used", "better_alternatives", "why"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["estimate", "summary", "suggestions"],
            "additionalProperties": False,
        },
        "coherence": {
            "type": "object",
            "properties": {
                "estimate": {"type": "number"},
                "summary": {"type": "string"},
                "relevance_to_question": {"type": "string"},
            },
            "required": ["estimate", "summary", "relevance_to_question"],
            "additionalProperties": False,
        },
        "improved_answer": {"type": "string"},
        "next_steps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["grammar", "vocabulary", "coherence", "improved_answer", "next_steps"],
    "additionalProperties": False,
}

SPEAKING_SYSTEM = (
    "You are an English speaking-practice tutor giving formative feedback on a learner's transcribed spoken "
    "answer to an IELTS-style practice question. The transcript comes from automatic speech recognition, which "
    "may drop fillers and contain recognition errors - do not penalize obvious recognition artifacts. "
    "Give practice ESTIMATES on a 0-9 scale in 0.5 steps for grammar (range and accuracy), vocabulary (lexical "
    "resource) and coherence (organisation and relevance). These are informal practice estimates, NOT official "
    "IELTS bands. Quote 'original' fragments exactly from the transcript. Give at most 5 grammar issues and 4 "
    "vocabulary suggestions. improved_answer: a natural, improved version of the learner's answer at roughly one "
    "level higher, keeping their ideas, max 120 words. next_steps: 2-3 short actionable items."
)


async def speaking_language_feedback(question: str, part: int, transcript: str, level: str, measured: dict) -> tuple[dict, dict]:
    user = json.dumps({
        "question": question,
        "speaking_part": part,
        "learner_level": level,
        "transcript": transcript,
        "measured_stats": measured,
    }, ensure_ascii=False)
    data, meta = await groq_client.chat_json(
        [{"role": "system", "content": SPEAKING_SYSTEM + " " + LEVEL_STYLE.get(level, "")},
         {"role": "user", "content": user}],
        "speaking_feedback",
        SPEAKING_SCHEMA,
        temperature=0.3,
        max_tokens=3000,
        reasoning_effort="medium",
    )
    for k in ("grammar", "vocabulary", "coherence"):
        est = data[k].get("estimate")
        if isinstance(est, (int, float)):
            data[k]["estimate"] = max(0.0, min(9.0, round(float(est) * 2) / 2))
    data["next_steps"] = data.get("next_steps", [])[:3]
    return data, meta
