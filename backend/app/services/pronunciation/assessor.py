"""Word-level pronunciation assessment from audio using CTC forced alignment.

Method ("CTC-GOP", word level):
 1. Run the acoustic model -> per-frame log posteriors over characters.
 2. Force-align the reference word sequence to the audio with CTC Viterbi
    (blank-interleaved state graph, standard CTC alignment).
 3. For each character in a word, take its peak posterior over the frames the
    alignment assigned to it. The word score is the geometric mean of those
    character posteriors, x100.
 4. Additionally, greedy (unconstrained) decoding over the word's time span is
    compared to the expected word, to show what the model actually heard there.

Interpretation: a low score means the acoustic model found weak evidence for the
expected word at that position - it may be mispronounced, skipped, or unclear.
It is NOT a phoneme-level diagnosis and the model was trained on LibriSpeech
audiobook speech, so accents can lower scores even when speech is intelligible.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

import numpy as np

from app.services.pronunciation.ctc_model import CTCModel

METHOD = "ctc-forced-alignment word confidence (character CTC, not phoneme-level)"
FRAME_S = 0.02
GOOD, FAIR = 75.0, 50.0


@dataclass
class WordPronunciation:
    index: int
    word: str
    score: float | None
    label: str  # good | unclear | likely_mispronounced | not_scored
    start: float | None
    end: float | None
    heard: str | None


@dataclass
class PronunciationResult:
    available: bool
    overall_score: float | None
    words: list[WordPronunciation]
    model: str | None
    method: str | None
    unavailable_reason: str | None = None
    duration_s: float | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _ref_words(reference: str) -> list[str]:
    out = []
    for raw in reference.split():
        w = re.sub(r"[^A-Za-z']", "", raw.replace("’", "'")).strip("'")
        if w:
            out.append(w)
    return out


def ctc_forced_align(lp: np.ndarray, targets: list[int], blank: int) -> list[int] | None:
    """Viterbi CTC alignment. Returns, per frame, the index into `targets` being emitted
    (or -1 for blank). Returns None if the audio is too short for the sequence."""
    T = lp.shape[0]
    L = len(targets)
    S = 2 * L + 1
    if L == 0 or T < L:
        return None
    states = np.full(S, blank, dtype=np.int64)
    states[1::2] = targets
    # Transition s-2 -> s allowed when s is a label and differs from label at s-2.
    skip_ok = np.zeros(S, dtype=bool)
    for s in range(3, S, 2):
        skip_ok[s] = states[s] != states[s - 2]
    neg = -1e18
    alpha = np.full(S, neg)
    alpha[0] = lp[0, states[0]]
    alpha[1] = lp[0, states[1]]
    back = np.zeros((T, S), dtype=np.int8)  # 0 stay, 1 from s-1, 2 from s-2
    emit = lp[:, states]  # (T, S)
    for t in range(1, T):
        stay = alpha
        prev1 = np.concatenate(([neg], alpha[:-1]))
        prev2 = np.concatenate(([neg, neg], alpha[:-2]))
        prev2 = np.where(skip_ok, prev2, neg)
        stacked = np.stack([stay, prev1, prev2])
        choice = stacked.argmax(axis=0)
        alpha = stacked[choice, np.arange(S)] + emit[t]
        back[t] = choice
    s = S - 1 if alpha[S - 1] >= alpha[S - 2] else S - 2
    if alpha[s] <= neg / 2:
        return None
    path = np.empty(T, dtype=np.int64)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(back[t, s])  # int(): avoid NumPy-2 int8 promotion overflowing for long sequences
    return [int(p // 2) if p % 2 == 1 else -1 for p in path]


def assess_pronunciation(model: CTCModel, audio: np.ndarray, reference: str) -> PronunciationResult:
    if not model.available:
        return PronunciationResult(False, None, [], None, None, model.error or "Pronunciation model unavailable")
    words = _ref_words(reference)
    if not words:
        return PronunciationResult(False, None, [], CTCModel.MODEL_NAME, METHOD, "Reference has no scorable words")
    lp = model.log_probs(audio)
    blank, sep = model.blank_id, model.sep_id

    targets: list[int] = []
    owner: list[tuple[int, int]] = []  # (word index, char index) for each target; (-1,-1) for separators
    for wi, w in enumerate(words):
        if wi > 0:
            targets.append(sep)
            owner.append((-1, -1))
        for ci, tid in enumerate(model.encode_word(w)):
            targets.append(tid)
            owner.append((wi, ci))

    path = ctc_forced_align(lp, targets, blank)
    if path is None:
        return PronunciationResult(
            False, None, [], CTCModel.MODEL_NAME, METHOD,
            "Recording is too short for the reference text, so it could not be aligned.",
            duration_s=len(audio) / 16000,
        )

    probs = np.exp(lp)
    # peak posterior per target and frame spans per word
    peak = np.zeros(len(targets))
    span: dict[int, list[int]] = {}
    for t, k in enumerate(path):
        if k < 0:
            continue
        p = probs[t, targets[k]]
        if p > peak[k]:
            peak[k] = p
        wi = owner[k][0]
        if wi >= 0:
            span.setdefault(wi, []).append(t)

    results: list[WordPronunciation] = []
    for wi, w in enumerate(words):
        ks = [k for k, (o, _) in enumerate(owner) if o == wi]
        if not ks or wi not in span:
            results.append(WordPronunciation(wi, w, None, "not_scored", None, None, None))
            continue
        char_p = np.clip(peak[ks], 1e-6, 1.0)
        score = float(np.exp(np.mean(np.log(char_p))) * 100.0)
        f0, f1 = min(span[wi]), max(span[wi])
        heard = model.greedy_decode(lp[max(0, f0 - 2) : f1 + 3]).strip() or None
        label = "good" if score >= GOOD else ("unclear" if score >= FAIR else "likely_mispronounced")
        results.append(
            WordPronunciation(wi, w, round(score, 1), label, round(f0 * FRAME_S, 2), round((f1 + 1) * FRAME_S, 2), heard)
        )

    scored = [r for r in results if r.score is not None]
    if scored:
        weights = np.array([len(r.word) for r in scored], dtype=float)
        overall = float(np.average([r.score for r in scored], weights=weights))
    else:
        overall = None
    return PronunciationResult(
        True,
        round(overall, 1) if overall is not None else None,
        results,
        CTCModel.MODEL_NAME,
        METHOD,
        duration_s=round(len(audio) / 16000, 2),
    )
