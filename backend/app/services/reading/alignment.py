"""Deterministic word-level alignment between a reference text and a recognized transcript.

Algorithm: Levenshtein (edit distance) dynamic programming over normalized word
tokens with unit costs for substitution, deletion and insertion, followed by a
deterministic backtrace. Ties are broken in the fixed order
match/substitution > deletion > insertion, so results are reproducible.

Normalization (applied to both sides, comparison only - display keeps the original):
  * Unicode NFKC, lower-case
  * curly apostrophes/quotes -> straight
  * leading/trailing punctuation stripped from each token (internal apostrophes kept,
    so "don't" != "do not" - contractions are a real reading difference)
  * hyphen / dash separated parts become separate tokens ("well-known" == "well known")
  * whole-number digits are spelled out ("3" == "three"), because Whisper may emit
    digits for spoken numbers; this is a formatting difference, not a reading error.

WER = (S + D + I) / N   where N = number of reference tokens.
Word-matching accuracy = max(0, 1 - WER) * 100, and is undefined (None) when N == 0.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field

_APOS = {"’": "'", "‘": "'", "ʼ": "'", "`": "'"}
_SPLIT_RE = re.compile(r"[\s‐-―\-/]+")
_EDGE_PUNCT_RE = re.compile(r"^[^\w']+|[^\w']+$")
_EDGE_APOS_RE = re.compile(r"^'+|'+$")

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def number_to_words(n: int) -> list[str]:
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        t, o = divmod(n, 10)
        return [_TENS[t]] + ([_ONES[o]] if o else [])
    if n < 1000:
        h, r = divmod(n, 100)
        return [_ONES[h], "hundred"] + (number_to_words(r) if r else [])
    if n < 1_000_000:
        th, r = divmod(n, 1000)
        return number_to_words(th) + ["thousand"] + (number_to_words(r) if r else [])
    return [str(n)]


def normalize_token(raw: str) -> list[str]:
    """Normalize one whitespace-delimited token into zero or more comparison tokens."""
    t = unicodedata.normalize("NFKC", raw).lower()
    for a, b in _APOS.items():
        t = t.replace(a, b)
    out: list[str] = []
    for part in _SPLIT_RE.split(t):
        part = _EDGE_PUNCT_RE.sub("", part)
        part = _EDGE_APOS_RE.sub("", part) if not re.search(r"\w'\w", part) else part
        part = part.strip("'") if part.endswith("'") and not part.endswith("s'") else part
        if not part:
            continue
        clean = part.replace(",", "")
        if clean.isdigit() and len(clean) <= 6:
            out.extend(number_to_words(int(clean)))
        else:
            out.append(part)
    return out


@dataclass
class Token:
    norm: str
    display: str
    display_index: int  # index of the original whitespace token this came from
    start: float | None = None
    end: float | None = None


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    for i, raw in enumerate(text.split()):
        for n in normalize_token(raw):
            tokens.append(Token(norm=n, display=raw, display_index=i))
    return tokens


def tokenize_timed(words: list[dict]) -> list[Token]:
    """Tokenize Whisper word-timestamp output: [{word, start, end}]."""
    tokens: list[Token] = []
    for i, w in enumerate(words):
        raw = str(w.get("word", "")).strip()
        for n in normalize_token(raw):
            tokens.append(Token(norm=n, display=raw, display_index=i, start=w.get("start"), end=w.get("end")))
    return tokens


@dataclass
class AlignmentOp:
    type: str  # correct | substitution | deletion | insertion
    ref: str | None
    hyp: str | None
    ref_index: int | None  # index into reference tokens
    hyp_index: int | None
    ref_display_index: int | None
    repeated: bool = False  # insertion that repeats an adjacent word
    start: float | None = None
    end: float | None = None


@dataclass
class AlignmentResult:
    ops: list[AlignmentOp]
    reference_word_count: int
    hypothesis_word_count: int
    correct: int
    substitutions: int
    deletions: int
    insertions: int
    repetitions: int
    wer: float | None
    accuracy: float | None  # percent, 0..100
    reference_words: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def align_tokens(ref: list[Token], hyp: list[Token]) -> list[AlignmentOp]:
    n, m = len(ref), len(hyp)
    # dp[i][j] = edit distance between ref[:i] and hyp[:j]
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = i
    for j in range(1, m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        ri = ref[i - 1].norm
        row, prev = dp[i], dp[i - 1]
        for j in range(1, m + 1):
            cost = 0 if ri == hyp[j - 1].norm else 1
            row[j] = min(prev[j - 1] + cost, prev[j] + 1, row[j - 1] + 1)

    ops: list[AlignmentOp] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            cost = 0 if ref[i - 1].norm == hyp[j - 1].norm else 1
            if dp[i][j] == dp[i - 1][j - 1] + cost:
                r, h = ref[i - 1], hyp[j - 1]
                ops.append(
                    AlignmentOp(
                        type="correct" if cost == 0 else "substitution",
                        ref=r.norm,
                        hyp=h.norm,
                        ref_index=i - 1,
                        hyp_index=j - 1,
                        ref_display_index=r.display_index,
                        start=h.start,
                        end=h.end,
                    )
                )
                i, j = i - 1, j - 1
                continue
        if i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            r = ref[i - 1]
            ops.append(AlignmentOp("deletion", r.norm, None, i - 1, None, r.display_index))
            i -= 1
            continue
        h = hyp[j - 1]
        ops.append(AlignmentOp("insertion", None, h.norm, None, j - 1, None, start=h.start, end=h.end))
        j -= 1
    ops.reverse()
    _mark_repetitions(ops, hyp)
    return ops


def _mark_repetitions(ops: list[AlignmentOp], hyp: list[Token]) -> None:
    """An inserted word is a repetition if it equals the previous or next spoken word."""
    for op in ops:
        if op.type != "insertion" or op.hyp_index is None:
            continue
        k = op.hyp_index
        prev_w = hyp[k - 1].norm if k > 0 else None
        next_w = hyp[k + 1].norm if k + 1 < len(hyp) else None
        if op.hyp in (prev_w, next_w):
            op.repeated = True


def align_texts(reference: str, hypothesis: str | None = None, hypothesis_words: list[dict] | None = None) -> AlignmentResult:
    ref = tokenize(reference)
    if hypothesis_words:
        hyp = tokenize_timed(hypothesis_words)
    else:
        hyp = tokenize(hypothesis or "")
    ops = align_tokens(ref, hyp)
    c = sum(o.type == "correct" for o in ops)
    s = sum(o.type == "substitution" for o in ops)
    d = sum(o.type == "deletion" for o in ops)
    ins = sum(o.type == "insertion" for o in ops)
    rep = sum(o.repeated for o in ops)
    n = len(ref)
    if n == 0:
        wer = None
        acc = None
    else:
        wer = (s + d + ins) / n
        acc = round(max(0.0, 1.0 - wer) * 100.0, 2)
        wer = round(wer, 4)
    return AlignmentResult(
        ops=ops,
        reference_word_count=n,
        hypothesis_word_count=len(hyp),
        correct=c,
        substitutions=s,
        deletions=d,
        insertions=ins,
        repetitions=rep,
        wer=wer,
        accuracy=acc,
        reference_words=reference.split(),
    )
