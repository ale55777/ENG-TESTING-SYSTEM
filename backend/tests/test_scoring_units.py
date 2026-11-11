import numpy as np
import pytest

from app.services.groq.content_policy import ContentRejected, check_text
from app.services.pronunciation.assessor import ctc_forced_align
from app.services.recommendations.engine import build_recommendations
from app.services.speaking.fluency import compute_fluency, fluency_estimate, pauses_from_vad
from app.services.typing.metrics import TypingValidationError, compute_typing_metrics

REF = "The quick brown fox jumps over the lazy dog."


# ---------------- typing
def test_typing_perfect():
    m = compute_typing_metrics(REF, REF, 60000, len(REF), 0, "practice")
    assert m.gross_wpm == round(len(REF) / 5, 2)
    assert m.net_wpm == m.gross_wpm and m.accuracy == 100.0 and m.completed


def test_typing_uncorrected_errors_reduce_net_wpm():
    typed = "The quack brawn fox"  # 2 wrong chars
    m = compute_typing_metrics(REF, typed, 30000, 19, 0, "challenge")
    assert m.uncorrected_errors == 2 and m.error_positions == [6, 12]
    assert m.gross_wpm == round((19 / 5) / 0.5, 2)
    assert m.net_wpm == round(m.gross_wpm - 2 / 0.5, 2)
    assert m.accuracy == round(17 / 19 * 100, 2)


def test_typing_corrected_errors_affect_keystroke_accuracy_only():
    m = compute_typing_metrics(REF, "The quick", 10000, 13, 4, "practice")
    assert m.accuracy == 100.0 and m.net_wpm == m.gross_wpm
    assert m.keystroke_accuracy == round((13 - 4) / 13 * 100, 2)


def test_challenge_mode_rejects_corrections():
    with pytest.raises(TypingValidationError):
        compute_typing_metrics(REF, "The", 1000, 5, 1, "challenge")


def test_typing_rejects_overlong_and_implausible():
    with pytest.raises(TypingValidationError):
        compute_typing_metrics("abc", "abcd", 1000, 4, 0, "practice")
    with pytest.raises(TypingValidationError):
        compute_typing_metrics(REF, REF, 100, len(REF), 0, "practice")  # pasted-speed
    with pytest.raises(TypingValidationError):
        compute_typing_metrics(REF, REF, 0, len(REF), 0, "practice")


# ---------------- CTC forced alignment
def _lp(frames: list[int], V: int = 6) -> np.ndarray:
    lp = np.full((len(frames), V), np.log(0.01))
    for t, k in enumerate(frames):
        lp[t, k] = np.log(0.95)
    return lp


def test_ctc_alignment_follows_peaks():
    # blank=0; target "1 2 2" requires a blank between the repeated 2s
    path = ctc_forced_align(_lp([0, 1, 1, 0, 2, 0, 2, 0]), [1, 2, 2], 0)
    assert path == [-1, 0, 0, -1, 1, -1, 2, -1]


def test_ctc_alignment_too_short_returns_none():
    assert ctc_forced_align(_lp([1, 2]), [1, 2, 3], 0) is None


def test_ctc_alignment_long_sequence_no_overflow():
    targets = [1 + (i % 4) for i in range(300)]
    frames = []
    for k in targets:
        frames += [k, 0]
    path = ctc_forced_align(_lp(frames), targets, 0)
    assert path is not None and max(path) == 299


# ---------------- fluency
def _tone_with_gaps(segments):
    sr = 16000
    parts = []
    for voiced, dur in segments:
        n = int(sr * dur)
        parts.append(0.3 * np.sin(2 * np.pi * 220 * np.arange(n) / sr) if voiced else np.zeros(n))
    return np.concatenate(parts).astype(np.float32)


def test_fluency_detects_pauses():
    audio = _tone_with_gaps([(0, 0.5), (1, 3), (0, 2), (1, 3), (0, 0.6), (1, 3), (0, 0.5)])
    words = " ".join(["word"] * 30)
    f = compute_fluency(audio, 16000, words, None)
    assert f["pause_count"] == 2 and f["long_pause_count"] == 1
    assert f["word_count"] == 30
    assert 10 <= f["speaking_window_s"] <= 12
    assert fluency_estimate(f) is not None


def test_fluency_estimate_requires_enough_speech():
    audio = _tone_with_gaps([(1, 2)])
    assert fluency_estimate(compute_fluency(audio, 16000, "hello there", None)) is None


def test_pauses_ignore_leading_and_trailing_silence():
    v = np.array([0] * 50 + [1] * 50 + [0] * 50, dtype=bool)
    assert pauses_from_vad(v) == []


# ---------------- content policy
def test_content_policy():
    assert check_text("A calm lake reflects the morning sky.", min_words=3, max_words=20)
    for bad in ("Visit https://x.com now please", "This is fucking great text", "hi"):
        with pytest.raises(ContentRejected):
            check_text(bad, min_words=3, max_words=20)


# ---------------- recommendations
def test_recommendations_for_new_user():
    recs = build_recommendations([])
    assert len(recs) == 1 and recs[0]["target"]["path"] == "/practice/reading"
