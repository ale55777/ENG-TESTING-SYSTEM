"""Measured fluency metrics from audio energy + Whisper word timestamps.

These are measurements, not judgements. The 0-9 "practice estimate" mapping in
`fluency_estimate` is a transparent heuristic, NOT an official IELTS band.
"""
from __future__ import annotations

import re

import numpy as np

FILLERS = {"um", "uh", "er", "erm", "ah", "hmm", "mm", "uhm"}
FRAME_S = 0.02


def voiced_frames(audio: np.ndarray, sr: int = 16000) -> np.ndarray:
    """Simple energy VAD: frame is voiced if RMS > adaptive threshold."""
    hop = int(sr * FRAME_S)
    if len(audio) < hop:
        return np.zeros(0, dtype=bool)
    n = len(audio) // hop
    frames = audio[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12)
    noise = np.percentile(rms, 10)
    peak = np.percentile(rms, 95)
    thr = max(noise * 3.0, noise + 0.1 * (peak - noise), 0.005)
    return rms > thr


def pauses_from_vad(voiced: np.ndarray, min_pause_s: float = 0.4) -> list[tuple[float, float]]:
    """Silent gaps strictly between speech regions, at least min_pause_s long."""
    pauses: list[tuple[float, float]] = []
    idx = np.flatnonzero(voiced)
    if idx.size == 0:
        return pauses
    first, last = idx[0], idx[-1]
    start = None
    for i in range(first, last + 1):
        if not voiced[i]:
            if start is None:
                start = i
        elif start is not None:
            dur = (i - start) * FRAME_S
            if dur >= min_pause_s:
                pauses.append((start * FRAME_S, dur))
            start = None
    return pauses


def compute_fluency(audio: np.ndarray, sr: int, transcript: str, words: list[dict] | None) -> dict:
    total_s = len(audio) / sr if sr else 0.0
    voiced = voiced_frames(audio, sr)
    speech_s = float(voiced.sum() * FRAME_S)
    pauses = pauses_from_vad(voiced)
    tokens = re.findall(r"[A-Za-z']+", transcript.lower())
    n_words = len([t for t in tokens if t not in FILLERS])
    fillers = sum(t in FILLERS for t in tokens)
    # Speaking window = first voiced frame to last voiced frame (ignores leading/trailing silence).
    idx = np.flatnonzero(voiced)
    window_s = float((idx[-1] - idx[0] + 1) * FRAME_S) if idx.size else 0.0
    wpm = n_words / (window_s / 60.0) if window_s > 1 else 0.0
    articulation = n_words / (speech_s / 60.0) if speech_s > 1 else 0.0
    long_pauses = [p for p in pauses if p[1] >= 1.5]
    return {
        "total_audio_s": round(total_s, 2),
        "speaking_window_s": round(window_s, 2),
        "voiced_s": round(speech_s, 2),
        "word_count": n_words,
        "speech_rate_wpm": round(wpm, 1),
        "articulation_rate_wpm": round(articulation, 1),
        "pause_count": len(pauses),
        "long_pause_count": len(long_pauses),
        "mean_pause_s": round(float(np.mean([p[1] for p in pauses])), 2) if pauses else 0.0,
        "phonation_ratio": round(speech_s / window_s, 3) if window_s else 0.0,
        "filler_count": fillers,
        "word_timestamps_available": bool(words),
        "notes": "Speech rate uses Whisper's transcript; Whisper often omits fillers like 'um', so filler counts are a lower bound.",
    }


def fluency_estimate(f: dict) -> float | None:
    """Heuristic 0-9 practice estimate from measured rate and pausing. Transparent and documented."""
    if f["word_count"] < 10 or f["speaking_window_s"] < 5:
        return None
    rate = f["speech_rate_wpm"]
    # Rate component: ~ 140-170 wpm natural conversational pace scores highest.
    if rate >= 140:
        rate_score = 9.0 if rate <= 190 else 8.0
    elif rate >= 60:
        rate_score = 3.0 + (rate - 60) / 80 * 6.0
    else:
        rate_score = max(1.0, rate / 20.0)
    minutes = f["speaking_window_s"] / 60.0
    long_per_min = f["long_pause_count"] / minutes if minutes else 0
    pause_penalty = min(3.0, long_per_min * 0.75)
    score = max(0.0, min(9.0, rate_score - pause_penalty))
    return round(score * 2) / 2  # nearest half point
