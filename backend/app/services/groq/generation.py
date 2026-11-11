"""AI exercise generation with Groq GPT-OSS (strict JSON schema outputs) + validation."""
from __future__ import annotations

from app.services.groq.client import groq_client
from app.services.groq.content_policy import check_text

LEVEL_GUIDE = {
    "beginner": "CEFR A2. Common everyday vocabulary, short simple sentences (8-12 words), present and past simple.",
    "intermediate": "CEFR B1-B2. Some less common vocabulary, compound and complex sentences (12-20 words).",
    "advanced": "CEFR C1. Rich, precise vocabulary, varied complex sentence structures, natural idiomatic phrasing.",
}
LENGTH_GUIDE = {"short": (2, 3, 20, 60), "medium": (4, 5, 45, 110), "long": (6, 8, 80, 170)}
VOCAB_GUIDE = {
    "simple": "Prefer the 2000 most common English words.",
    "moderate": "Mix common words with some topic-specific vocabulary.",
    "rich": "Include several precise, less common words suitable for the level.",
}
SAFE_SYSTEM = (
    "You write material for an English-learning website used by learners of all ages. "
    "Content must be safe for work, culturally neutral, factual where facts appear, and free of violence, "
    "sexual content, politics, religion, profanity, brand names and personal data. Use standard English spelling."
)

PARAGRAPH_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "paragraph": {"type": "string"},
        "key_vocabulary": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "paragraph", "key_vocabulary"],
    "additionalProperties": False,
}


async def generate_paragraph(topic: str, difficulty: str, length: str, vocabulary: str, mode: str) -> tuple[dict, dict]:
    smin, smax, wmin, wmax = LENGTH_GUIDE.get(length, LENGTH_GUIDE["short"])
    style = {
        "standard": "a clear informative paragraph",
        "story": "a short narrative story paragraph",
        "dialogue_free": "a descriptive paragraph",
        "news": "a neutral news-style paragraph about a positive everyday topic",
    }.get(mode, "a clear informative paragraph")
    user = (
        f"Write {style} for reading-aloud practice.\n"
        f"Topic: {topic[:80] or 'everyday life'}\nLevel: {LEVEL_GUIDE[difficulty]}\n"
        f"Vocabulary: {VOCAB_GUIDE.get(vocabulary, VOCAB_GUIDE['moderate'])}\n"
        f"Length: {smin}-{smax} sentences, {wmin}-{wmax} words in total. "
        "Plain prose only: no lists, headings, quotation marks, abbreviations, numerals or special symbols "
        "(spell numbers as words). Title max 6 words. key_vocabulary: 3-5 useful words from the paragraph."
    )
    last_err: Exception | None = None
    for _ in range(2):
        data, meta = await groq_client.chat_json(
            [{"role": "system", "content": SAFE_SYSTEM}, {"role": "user", "content": user}],
            "reading_paragraph",
            PARAGRAPH_SCHEMA,
            temperature=0.9,
            max_tokens=1200,
        )
        try:
            para = check_text(data["paragraph"], min_words=max(12, wmin - 15), max_words=wmax + 30, field="paragraph")
            title = check_text(data["title"], min_words=1, max_words=10, field="title")
            vocab = [v.strip() for v in data.get("key_vocabulary", []) if v.strip()][:6]
            return {"title": title, "content": para, "details": {"topic": topic, "key_vocabulary": vocab,
                                                                  "length": length, "vocabulary": vocabulary, "mode": mode}}, meta
        except ValueError as exc:
            last_err = exc
    raise last_err or ValueError("generation failed")


TWISTER_SCHEMA = {
    "type": "object",
    "properties": {
        "twister": {"type": "string"},
        "target_sounds": {"type": "array", "items": {"type": "string"}},
        "tip": {"type": "string"},
    },
    "required": ["twister", "target_sounds", "tip"],
    "additionalProperties": False,
}
TWISTER_LEVEL = {
    "beginner": "easy: 5-9 words, one repeated sound, simple words",
    "intermediate": "medium: 8-14 words, two contrasting sounds (for example r/l or s/sh)",
    "advanced": "hard: 10-18 words, rapid alternation of similar consonant clusters (for example th/s/sh, sixth/sheep)",
}


async def generate_tongue_twister(difficulty: str, focus_sound: str | None) -> tuple[dict, dict]:
    focus = f"Focus on the sound(s): {focus_sound[:20]}." if focus_sound else "Choose sounds that English learners commonly find difficult."
    user = (
        f"Create one ORIGINAL English tongue twister ({TWISTER_LEVEL[difficulty]}). {focus} "
        "It must be grammatical, make some sense, and use only real English words. No numerals. "
        "target_sounds: 1-3 short labels such as '/s/ vs /sh/' or 'th'. tip: one sentence on how to say it."
    )
    for _ in range(2):
        data, meta = await groq_client.chat_json(
            [{"role": "system", "content": SAFE_SYSTEM}, {"role": "user", "content": user}],
            "tongue_twister",
            TWISTER_SCHEMA,
            temperature=1.0,
            max_tokens=800,
        )
        try:
            text = check_text(data["twister"], min_words=4, max_words=24, field="twister")
            tip = check_text(data["tip"], min_words=3, max_words=40, field="tip")
            sounds = [x.strip()[:24] for x in data["target_sounds"] if x.strip()][:3]
            return {"title": "AI tongue twister", "content": text, "details": {"target_sounds": sounds, "tip": tip}}, meta
        except ValueError:
            continue
    raise ValueError("Generated tongue twister failed validation")


QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "bullet_points": {"type": "array", "items": {"type": "string"}},
        "follow_up_tip": {"type": "string"},
    },
    "required": ["question", "bullet_points", "follow_up_tip"],
    "additionalProperties": False,
}
PART_GUIDE = {
    1: "Part 1 style: a short personal question about familiar topics (home, work, hobbies). No bullet points (empty list).",
    2: "Part 2 style cue card: 'Describe ...' with exactly 3-4 bullet points beginning 'what', 'when', 'why' or 'how', and 'and explain ...'.",
    3: "Part 3 style: an abstract discussion question about society or trends related to the topic. No bullet points (empty list).",
}


async def generate_speaking_question(part: int, topic: str | None, difficulty: str) -> tuple[dict, dict]:
    user = (
        f"Write one IELTS-style speaking practice prompt. {PART_GUIDE[part]} "
        f"Topic area: {(topic or 'any everyday topic')[:60]}. Learner level: {difficulty}. "
        "follow_up_tip: one sentence advising how to structure a good answer."
    )
    for _ in range(2):
        data, meta = await groq_client.chat_json(
            [{"role": "system", "content": SAFE_SYSTEM}, {"role": "user", "content": user}],
            "speaking_question",
            QUESTION_SCHEMA,
            temperature=0.9,
            max_tokens=800,
        )
        try:
            q = check_text(data["question"], min_words=4, max_words=40, field="question")
            bullets = [check_text(b, min_words=1, max_words=16, field="bullet") for b in data["bullet_points"]][:4] if part == 2 else []
            tip = check_text(data["follow_up_tip"], min_words=3, max_words=40, field="tip")
            return {"title": f"Speaking Part {part}", "content": q,
                    "details": {"part": part, "bullet_points": bullets, "tip": tip, "topic": topic or "",
                                **SPEAKING_TIMING[part]}}, meta
        except ValueError:
            continue
    raise ValueError("Generated speaking question failed validation")


SPEAKING_TIMING = {
    1: {"prep_seconds": 0, "speak_seconds": 45},
    2: {"prep_seconds": 60, "speak_seconds": 120},
    3: {"prep_seconds": 0, "speak_seconds": 90},
}
