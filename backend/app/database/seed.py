"""Idempotent seed data: difficulty levels, categories and predefined (offline) exercises."""
from __future__ import annotations

import hashlib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DifficultyLevel, Exercise, ExerciseCategory

LEVELS = [
    ("beginner", "Beginner", "Simple vocabulary, short sentences, slower reference audio.", 0, 0.85),
    ("intermediate", "Intermediate", "Longer sentences, more complex grammar, moderate speaking exercises.", 1, 1.0),
    ("advanced", "Advanced", "Complex paragraphs, challenging tongue twisters, extended speaking responses.", 2, 1.1),
]

CATEGORIES = [
    ("reading-everyday", "Everyday life", "reading"),
    ("reading-science", "Science & nature", "reading"),
    ("reading-work", "Work & study", "reading"),
    ("twister-classic", "Classic tongue twisters", "tongue_twister"),
    ("pron-sounds", "Difficult English sounds", "pronunciation"),
    ("speaking-ielts", "IELTS-style speaking", "speaking"),
    ("typing-general", "General typing", "typing"),
]

READING = [
    ("beginner", "reading-everyday", "Daily practice",
     "Learning English requires patience and regular practice. Speaking clearly helps people communicate their ideas. Small improvements every day can lead to greater confidence."),
    ("beginner", "reading-everyday", "A morning walk",
     "Every morning, Anna walks to the park near her house. She likes the fresh air and the sound of the birds. After her walk, she drinks a cup of tea and reads a book."),
    ("beginner", "reading-work", "My new class",
     "Tom started a new English class this week. The teacher is kind and the lessons are fun. He practises speaking with his classmates every afternoon."),
    ("intermediate", "reading-science", "Why leaves change colour",
     "In autumn, many trees prepare for the cold months by slowing down their growth. As the green pigment in their leaves breaks down, yellow and orange colours that were hidden all summer become visible. This beautiful change is a sign that the tree is protecting itself for winter."),
    ("intermediate", "reading-work", "Working from home",
     "Working from home has become common in many industries. While it saves time that would otherwise be spent travelling, it also requires discipline and good communication. Successful remote workers usually set clear routines and take regular breaks."),
    ("intermediate", "reading-everyday", "The local market",
     "On Saturday mornings, the local market fills with farmers selling fresh vegetables, bread and honey. Shoppers compare prices, chat with the sellers and sometimes try free samples. For many families, the market is as much a social event as a place to shop."),
    ("advanced", "reading-science", "The ocean's influence",
     "The world's oceans absorb an enormous quantity of heat and carbon dioxide, moderating the planet's climate in ways scientists are still working to understand. Subtle shifts in ocean currents can alter rainfall patterns thousands of kilometres away, demonstrating how intricately connected Earth's systems really are."),
    ("advanced", "reading-work", "Lifelong learning",
     "In a rapidly evolving economy, the ability to acquire new skills has arguably become more valuable than any single qualification. Professionals who cultivate curiosity and deliberately seek out unfamiliar challenges tend to adapt more successfully, whereas those who rely exclusively on past expertise may find their knowledge gradually becoming obsolete."),
    ("advanced", "reading-everyday", "The art of conversation",
     "Genuine conversation is a surprisingly sophisticated skill. Beyond simply exchanging information, skilled speakers listen attentively, acknowledge differing perspectives and adjust their tone to suit the situation, transforming an ordinary exchange into a meaningful connection."),
]

TWISTERS = [
    ("beginner", "She sells seashells by the seashore.", ["/s/ vs /sh/"], "Keep the tongue behind the teeth for /s/; round the lips for /sh/."),
    ("beginner", "Fresh fried fish, fish fresh fried.", ["/f/", "/fr/"], "Touch your top teeth to your bottom lip for every /f/."),
    ("beginner", "Big black bugs bleed blue black blood.", ["/b/", "/bl/"], "Press the lips together firmly before each /b/."),
    ("intermediate", "Red lorry, yellow lorry, red lorry, yellow lorry.", ["/r/ vs /l/"], "For /l/ touch the tongue tip to the ridge behind your teeth; for /r/ do not touch anything."),
    ("intermediate", "Peter Piper picked a peck of pickled peppers.", ["/p/"], "Release a small puff of air on each stressed /p/."),
    ("intermediate", "How much wood would a woodchuck chuck if a woodchuck could chuck wood?", ["/w/", "/ch/"], "Round your lips for /w/; start /ch/ with the tongue against the roof of the mouth."),
    ("advanced", "The sixth sick sheikh's sixth sheep's sick.", ["/s/ vs /sh/", "/ks/ clusters", "th"], "Go slowly at first: separate 'sixth' (siks-th) from 'sick'."),
    ("advanced", "Thirty-three thirsty thieves thought they thrilled the throne throughout Thursday.", ["voiceless th", "/θr/"], "Put the tongue lightly between the teeth for every 'th' and blow air."),
    ("advanced", "Six slippery snails slid slowly seaward.", ["/s/ clusters", "/sl/"], "Keep a steady rhythm; do not add a vowel between s and l."),
]

PRONUNCIATION = [
    ("beginner", "Voiceless th", "think three thank thought thin", ["voiceless th /θ/"]),
    ("beginner", "R and L", "right light road load rice lice", ["/r/ vs /l/"]),
    ("beginner", "V and W", "very well vine wine vest west", ["/v/ vs /w/"]),
    ("intermediate", "Short and long i", "ship sheep live leave bit beat", ["/ɪ/ vs /iː/"]),
    ("intermediate", "Th in a sentence", "Thank you for thinking of the three of them on Thursday.", ["/θ/ and /ð/"]),
    ("intermediate", "R and L in a sentence", "The little rabbit ran along the long red road.", ["/r/ vs /l/"]),
    ("advanced", "Consonant clusters", "The texts asked for the sixth strengths of the scripts.", ["final consonant clusters"]),
    ("advanced", "Word stress", "The photographer took a photograph of the photography class.", ["word stress"]),
    ("advanced", "Linking sounds", "Turn it off and pick it up at eight o'clock.", ["linking", "connected speech"]),
]

SPEAKING = [
    (1, "beginner", "What do you usually do in your free time?", []),
    (1, "beginner", "Do you prefer mornings or evenings? Why?", []),
    (1, "intermediate", "How often do you use public transport, and what do you think of it?", []),
    (2, "intermediate", "Describe a place you would like to visit and explain why.",
     ["where the place is", "how you learned about it", "what you would do there"]),
    (2, "advanced", "Describe a skill you learned that took a long time to master.",
     ["what the skill is", "how you learned it", "what difficulties you faced"]),
    (3, "intermediate", "How has technology changed the way people learn languages?", []),
    (3, "advanced", "Do you think governments should invest more in public libraries in the digital age?", []),
]

TYPING = [
    ("beginner", "The quick brown fox", "The quick brown fox jumps over the lazy dog. Practice makes progress, so type a little every day."),
    ("beginner", "Simple routine", "I wake up early, drink some water and make a simple breakfast. Then I check my plans for the day."),
    ("intermediate", "Clear communication", "Clear communication is important in every workplace. Write short sentences, choose precise words, and always check your message before you send it."),
    ("intermediate", "Healthy habits", "Regular exercise, enough sleep and a balanced diet help people concentrate better. Small, consistent habits often matter more than dramatic changes."),
    ("advanced", "Curiosity", "Curiosity drives discovery: scientists question assumptions, test hypotheses rigorously, and revise their conclusions when new evidence emerges. That willingness to be wrong is, paradoxically, what makes science so reliable."),
    ("advanced", "Punctuation drill", "Despite the delay (nearly forty minutes!), the committee's final report was approved; however, several members requested further changes, including clearer figures and a shorter summary."),
]

from app.services.groq.generation import SPEAKING_TIMING  # noqa: E402


def content_hash(exercise_type: str, content: str) -> str:
    return hashlib.sha256(f"{exercise_type}|{' '.join(content.split()).lower()}".encode()).hexdigest()


async def seed(db: AsyncSession) -> int:
    added = 0
    existing_levels = {lv.code for lv in (await db.scalars(select(DifficultyLevel))).all()}
    for code, label, desc, order, speed in LEVELS:
        if code not in existing_levels:
            db.add(DifficultyLevel(code=code, label=label, description=desc, sort_order=order, tts_speed=speed))
    cats = {c.slug: c for c in (await db.scalars(select(ExerciseCategory))).all()}
    for slug, name, et in CATEGORIES:
        if slug not in cats:
            c = ExerciseCategory(slug=slug, name=name, exercise_type=et)
            db.add(c)
            cats[slug] = c
    await db.flush()
    hashes = set((await db.scalars(select(Exercise.content_hash).where(Exercise.source == "predefined"))).all())

    def add(et: str, diff: str, title: str, content: str, details: dict, cat: str) -> None:
        nonlocal added
        h = content_hash(et, content)
        if h in hashes:
            return
        db.add(Exercise(exercise_type=et, difficulty=diff, title=title, content=content, details=details,
                        source="predefined", status="active", content_hash=h, category_id=cats[cat].id))
        hashes.add(h)
        added += 1

    for diff, cat, title, text in READING:
        add("reading", diff, title, text, {"topic": cats[cat].name}, cat)
    for diff, text, sounds, tip in TWISTERS:
        add("tongue_twister", diff, "Tongue twister", text, {"target_sounds": sounds, "tip": tip}, "twister-classic")
    for diff, title, text, sounds in PRONUNCIATION:
        add("pronunciation", diff, title, text, {"target_sounds": sounds}, "pron-sounds")
    for part, diff, q, bullets in SPEAKING:
        add("speaking", diff, f"Speaking Part {part}", q, {"part": part, "bullet_points": bullets, "tip": "", **SPEAKING_TIMING[part]}, "speaking-ielts")
    for diff, title, text in TYPING:
        add("typing", diff, title, text, {}, "typing-general")
    await db.commit()
    return added
