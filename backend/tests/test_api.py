"""API tests. Groq and Ably are mocked; the local acoustic model is replaced with a stub."""
from __future__ import annotations

import io

import numpy as np
import pytest
import soundfile as sf

from app.core.config import get_settings
from app.realtime import ably as ably_mod
from app.services.groq.client import Transcription, groq_client
from app.services.pronunciation.assessor import PronunciationResult
from tests.conftest import register

pytestmark = pytest.mark.asyncio
API = "/api/v1"


def wav_bytes(seconds: float = 2.0, sr: int = 16000) -> bytes:
    t = np.arange(int(sr * seconds)) / sr
    x = 0.3 * np.sin(2 * np.pi * 200 * t) * (np.sin(2 * np.pi * 2 * t) > 0)
    buf = io.BytesIO()
    sf.write(buf, x.astype(np.float32), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture
def mock_groq(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "groq_api_key", "test-key")
    calls = {"transcribe": 0, "stream": 0, "json": 0}
    state = {"text": ""}

    async def fake_transcribe(wav, prompt=None, word_timestamps=True):
        calls["transcribe"] += 1
        words = [{"word": w, "start": i * 0.3, "end": i * 0.3 + 0.25} for i, w in enumerate(state["text"].split())]
        return Transcription(state["text"], words, [], "en", 2.0, "whisper-large-v3-turbo", 120)

    async def fake_stream(messages, **kw):
        calls["stream"] += 1
        for tok in ["Good ", "effort! ", "Practise ", "'patience'."]:
            yield tok

    async def fake_json(messages, name, schema, **kw):
        calls["json"] += 1
        if name == "reading_paragraph":
            return {"title": "Morning Coffee", "paragraph": "Many people enjoy a warm cup of coffee in the morning. It helps them feel awake and ready for the day ahead.", "key_vocabulary": ["awake"]}, {"model": "openai/gpt-oss-20b"}
        if name == "speaking_feedback":
            return {
                "grammar": {"estimate": 6.3, "summary": "Mostly accurate.", "issues": [{"original": "I goes", "correction": "I go", "explanation": "Subject-verb agreement."}]},
                "vocabulary": {"estimate": 6.0, "summary": "Adequate range.", "suggestions": []},
                "coherence": {"estimate": 7.0, "summary": "Clear.", "relevance_to_question": "Relevant."},
                "improved_answer": "In my free time I usually read.", "next_steps": ["Use linking words."],
            }, {"model": "openai/gpt-oss-20b", "latency_ms": 10}
        raise AssertionError(name)

    monkeypatch.setattr(groq_client, "transcribe", fake_transcribe)
    monkeypatch.setattr(groq_client, "chat_stream", fake_stream)
    monkeypatch.setattr(groq_client, "chat_json", fake_json)
    return state, calls


@pytest.fixture
def stub_pron(monkeypatch):
    from app.api.v1 import assessments

    def fake(model, audio, reference):
        return PronunciationResult(True, 88.0, [], "stub-model", "stub", None, 2.0)

    monkeypatch.setattr(assessments, "assess_pronunciation", fake)


@pytest.fixture
def ably_events(monkeypatch):
    events = []

    async def fake_publish(user_id, event_type, payload, *, session_id, seq):
        events.append((event_type, f"{session_id}:{seq}", payload))
        return f"{session_id}:{seq}"

    monkeypatch.setattr(ably_mod.publisher, "publish", fake_publish)
    return events


# ---------------------------------------------------------------- auth
async def test_register_login_logout_and_me(client):
    u = await register(client)
    assert u["role"] == "admin"  # first account
    u2 = await register(client, "learner@example.com")
    assert u2["role"] == "learner"
    assert (await client.get(f"{API}/auth/me")).json()["user"]["email"] == "learner@example.com"
    await client.post(f"{API}/auth/logout")
    client.cookies.clear()
    assert (await client.get(f"{API}/auth/me")).status_code == 401
    r = await client.post(f"{API}/auth/login", json={"email": "learner@example.com", "password": "wrong-pass1"})
    assert r.status_code == 401
    r = await client.post(f"{API}/auth/login", json={"email": "LEARNER@example.com", "password": "secret123"})
    assert r.status_code == 200


async def test_duplicate_and_weak_password(client):
    await register(client)
    r = await client.post(f"{API}/auth/register", json={"email": "admin@example.com", "password": "secret123", "display_name": "x"})
    assert r.status_code == 409
    r = await client.post(f"{API}/auth/register", json={"email": "b@example.com", "password": "short", "display_name": "x"})
    assert r.status_code == 422


async def test_password_stored_hashed(client):
    from sqlalchemy import select

    from app.database.session import SessionLocal
    from app.models import User

    await register(client)
    async with SessionLocal() as db:
        u = await db.scalar(select(User))
        assert u.password_hash != "secret123" and u.password_hash.startswith("$2")


async def test_csrf_header_required(client):
    r = await client.post(f"{API}/auth/login", json={"email": "a@b.com", "password": "x"}, headers={"X-Requested-With": ""})
    assert r.status_code == 403


async def test_admin_authorization(client):
    await register(client)
    assert (await client.get(f"{API}/admin/overview")).status_code == 200
    client.cookies.clear()
    await register(client, "learner@example.com")
    for path in ("/admin/overview", "/admin/users", "/admin/exercises", "/admin/errors", "/admin/health"):
        assert (await client.get(API + path)).status_code == 403


async def test_users_cannot_access_each_others_attempts(client):
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "typing"})).json()["items"][0]
    r = await client.post(f"{API}/assessments/typing", json={"exercise_id": ex["id"], "content_hash": ex["content_hash"], "mode": "practice",
                                                             "typed_text": ex["content"][:20], "elapsed_ms": 10000, "total_keystrokes": 20, "corrected_errors": 0})
    aid = r.json()["attempt"]["id"]
    client.cookies.clear()
    await register(client, "other@example.com")
    assert (await client.get(f"{API}/attempts/{aid}")).status_code == 404
    assert (await client.get(f"{API}/reports/attempts/{aid}")).status_code == 404


# ---------------------------------------------------------------- exercises
async def test_generation_unavailable_without_groq(client):
    await register(client)
    r = await client.post(f"{API}/exercises/generate", json={"exercise_type": "reading"})
    assert r.status_code == 503
    assert (await client.get(f"{API}/exercises", params={"type": "reading"})).json()["items"]


async def test_generation_with_groq_saves_and_emits(client, mock_groq, ably_events):
    await register(client)
    r = await client.post(f"{API}/exercises/generate", json={"exercise_type": "reading", "topic": "coffee"})
    assert r.status_code == 201, r.text
    ex = r.json()["exercise"]
    assert ex["source"] == "ai" and "coffee" in ex["content"]
    assert any(e[0] == "exercise.created" for e in ably_events)


# ---------------------------------------------------------------- reading flow
async def test_reading_assessment_end_to_end(client, mock_groq, stub_pron, ably_events):
    state, calls = mock_groq
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "reading", "difficulty": "beginner"})).json()["items"][0]
    words = ex["content"].split()
    spoken = words[:3] + ["um"] + words[4:]  # one substitution
    state["text"] = " ".join(spoken)
    r = await client.post(f"{API}/assessments/reading", data={"exercise_id": ex["id"], "content_hash": ex["content_hash"], "session_id": "sess12345"},
                          files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    assert r.status_code == 201, r.text
    a = r.json()["attempt"]
    n = len(words)
    assert a["alignment"]["substitutions"] == 1 and a["alignment"]["correct"] == n - 1
    assert a["word_accuracy"] == round((1 - 1 / n) * 100, 2)
    assert a["pronunciation_score"] == 88.0
    # background feedback ran (ASGI transport waits for background tasks)
    d = (await client.get(f"{API}/attempts/{a['id']}")).json()["attempt"]
    assert d["feedback"]["status"] == "ready" and d["feedback"]["text"] == "Good effort! Practise 'patience'."
    assert d["metrics"]["accuracy"] == a["word_accuracy"]  # LLM never touched metrics
    types = [e[0] for e in ably_events]
    for t in ("assessment.started", "transcript.final", "assessment.completed", "feedback.delta", "feedback.completed"):
        assert t in types
    ids = [e[1] for e in ably_events]
    assert len(ids) == len(set(ids))  # unique event ids -> client dedupe works


async def test_reference_frozen(client, mock_groq, stub_pron):
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "reading"})).json()["items"][0]
    r = await client.post(f"{API}/assessments/reading", data={"exercise_id": ex["id"], "content_hash": "0" * 64},
                          files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    assert r.status_code == 409


async def test_audio_validation(client, mock_groq):
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "reading"})).json()["items"][0]
    data = {"exercise_id": ex["id"], "content_hash": ex["content_hash"]}
    r = await client.post(f"{API}/assessments/reading", data=data, files={"audio": ("a.wav", b"garbage", "audio/wav")})
    assert r.status_code == 422
    r = await client.post(f"{API}/assessments/reading", data=data, files={"audio": ("a.wav", wav_bytes(0.1), "audio/wav")})
    assert r.status_code == 422


async def test_tongue_twister_pace_requires_intelligibility(client, mock_groq, stub_pron):
    state, _ = mock_groq
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "tongue_twister", "difficulty": "beginner"})).json()["items"][0]
    state["text"] = "she sells"
    r = await client.post(f"{API}/assessments/reading", data={"exercise_id": ex["id"], "content_hash": ex["content_hash"]},
                          files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    a = r.json()["attempt"]
    assert a["exercise_type"] == "tongue_twister"
    assert a["metrics"]["pace_rated"] is False


async def test_transcription_network_failure_returns_502(client, monkeypatch, stub_pron):
    from app.services.groq.client import GroqError

    monkeypatch.setattr(get_settings(), "groq_api_key", "k")

    async def boom(*a, **k):
        raise GroqError("Network error contacting Groq: ConnectError", 502, retryable=True)

    monkeypatch.setattr(groq_client, "transcribe", boom)
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "reading"})).json()["items"][0]
    r = await client.post(f"{API}/assessments/reading", data={"exercise_id": ex["id"], "content_hash": ex["content_hash"]},
                          files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    assert r.status_code == 502 and "Transcription failed" in r.json()["detail"]
    assert (await client.get(f"{API}/attempts")).json()["total"] == 0


async def test_feedback_failure_falls_back_to_rules(client, mock_groq, stub_pron, monkeypatch):
    state, _ = mock_groq
    from app.services.groq.client import GroqError

    async def broken_stream(messages, **kw):
        raise GroqError("down", 503)
        yield  # pragma: no cover

    monkeypatch.setattr(groq_client, "chat_stream", broken_stream)
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "reading"})).json()["items"][0]
    state["text"] = ex["content"]
    r = await client.post(f"{API}/assessments/reading", data={"exercise_id": ex["id"], "content_hash": ex["content_hash"]},
                          files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    d = (await client.get(f"{API}/attempts/{r.json()['attempt']['id']}")).json()["attempt"]
    assert d["feedback"]["source"] == "rule-based" and d["feedback"]["status"] == "ready"


# ---------------------------------------------------------------- speaking
async def test_speaking_assessment(client, mock_groq, stub_pron):
    state, _ = mock_groq
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "speaking"})).json()["items"][0]
    state["text"] = "In my free time I goes to the park and I read books with my friends every weekend."
    r = await client.post(f"{API}/assessments/speaking", data={"exercise_id": ex["id"]}, files={"audio": ("a.wav", wav_bytes(6), "audio/wav")})
    assert r.status_code == 201, r.text
    d = (await client.get(f"{API}/attempts/{r.json()['attempt']['id']}")).json()["attempt"]
    est = d["speaking"]["estimates"]
    assert est["grammar"] == 6.5 and est["coherence"] == 7.0  # rounded to half points, clamped
    assert "Not official IELTS" in d["speaking"]["notes"]
    assert d["speaking"]["language"]["grammar"]["issues"][0]["correction"] == "I go"


# ---------------------------------------------------------------- typing, history, reports, progress
async def test_typing_history_reports_progress(client):
    await register(client)
    ex = (await client.get(f"{API}/exercises", params={"type": "typing"})).json()["items"][0]
    body = {"exercise_id": ex["id"], "content_hash": ex["content_hash"], "mode": "challenge", "typed_text": ex["content"][:25],
            "elapsed_ms": 15000, "total_keystrokes": 25, "corrected_errors": 0}
    r = await client.post(f"{API}/assessments/typing", json=body)
    assert r.status_code == 201
    t = r.json()["attempt"]["typing"]
    assert t["gross_wpm"] == 20.0 and t["accuracy"] == 100.0
    bad = dict(body, corrected_errors=2)
    assert (await client.post(f"{API}/assessments/typing", json=bad)).status_code == 422

    lst = (await client.get(f"{API}/attempts", params={"type": "typing"})).json()
    assert lst["total"] == 1
    aid = lst["items"][0]["id"]
    for fmt, ctype in (("pdf", "application/pdf"), ("json", "application/json"), ("txt", "text/plain")):
        r = await client.get(f"{API}/reports/attempts/{aid}", params={"format": fmt})
        assert r.status_code == 200 and r.headers["content-type"].startswith(ctype)
    assert b"not an official" in (await client.get(f"{API}/reports/attempts/{aid}", params={"format": "txt"})).content
    summ = (await client.get(f"{API}/progress/summary")).json()
    assert summ["total_sessions"] == 1 and summ["typing_wpm_avg"] == 20.0 and summ["streak_days"] == 1
    ts = (await client.get(f"{API}/progress/timeseries")).json()["points"]
    assert ts and ts[-1]["sessions"] == 1
    assert (await client.get(f"{API}/recommendations")).json()["items"]
    assert (await client.delete(f"{API}/profile/history")).json()["deleted_attempts"] == 1
    assert (await client.get(f"{API}/attempts")).json()["total"] == 0


async def test_new_user_dashboard_is_empty(client):
    await register(client)
    s = (await client.get(f"{API}/progress/summary")).json()
    assert s["total_sessions"] == 0 and s["reading_accuracy_avg"] is None and s["recent"] == []


async def test_realtime_token_scoped(client, monkeypatch):
    import jwt

    u = await register(client)
    assert (await client.get(f"{API}/realtime/token")).status_code == 503
    monkeypatch.setattr(get_settings(), "ably_api_key", "app123.key456:supersecret-0123456789abcdefghijklmn")
    tok = (await client.get(f"{API}/realtime/token")).json()
    claims = jwt.decode(tok["token"], "supersecret-0123456789abcdefghijklmn", algorithms=["HS256"])
    assert jwt.get_unverified_header(tok["token"])["kid"] == "app123.key456"
    assert claims["x-ably-clientId"] == u["id"]
    assert claims["x-ably-capability"] == '{"learner:%s": ["subscribe", "history"]}' % u["id"]


async def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_rate_limit_per_minute", 2)
    await register(client)
    codes = [(await client.post(f"{API}/exercises/generate", json={"exercise_type": "reading"})).status_code for _ in range(3)]
    assert codes[-1] == 429


async def test_health(client):
    r = await client.get(f"{API}/health")
    assert r.status_code == 200 and r.json()["database"]["ok"] is True
    assert r.json()["privacy"]["audio_retained"] is False
