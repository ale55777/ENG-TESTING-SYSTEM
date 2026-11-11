"""Deterministic typing metrics.

Definitions (documented in README):
  minutes            = elapsed_ms / 60000 (client measures with performance.now(), a monotonic clock)
  typed_chars        = length of the final submitted text
  correct_chars      = positions i where typed[i] == reference[i]
  uncorrected_errors = typed_chars - correct_chars  (errors still present at the end)
  corrected_errors   = wrong characters the learner typed and later deleted (practice mode only;
                       always 0 in challenge mode because deletion is impossible)
  gross_wpm          = (typed_chars / 5) / minutes
  net_wpm            = max(0, gross_wpm - uncorrected_errors / minutes)
                       Corrected errors do not reduce net WPM directly; they already cost time.
  accuracy           = correct_chars / typed_chars * 100        (character accuracy of final text)
  keystroke_accuracy = (total_keystrokes - error_keystrokes) / total_keystrokes * 100
  error_rate         = uncorrected_errors / typed_chars * 100
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

MAX_PLAUSIBLE_GROSS_WPM = 300.0


class TypingValidationError(ValueError):
    pass


@dataclass
class TypingMetrics:
    gross_wpm: float
    net_wpm: float
    accuracy: float
    keystroke_accuracy: float | None
    correct_chars: int
    incorrect_chars: int
    corrected_errors: int
    uncorrected_errors: int
    total_keystrokes: int
    typed_chars: int
    elapsed_ms: int
    error_rate: float
    completed: bool
    error_positions: list[int]

    def to_dict(self) -> dict:
        return asdict(self)


def compute_typing_metrics(
    reference: str,
    typed: str,
    elapsed_ms: int,
    total_keystrokes: int,
    corrected_errors: int,
    mode: str,
) -> TypingMetrics:
    if mode not in ("practice", "challenge"):
        raise TypingValidationError("mode must be 'practice' or 'challenge'")
    if elapsed_ms <= 0:
        raise TypingValidationError("elapsed time must be positive")
    if len(typed) > len(reference):
        raise TypingValidationError("typed text is longer than the reference text")
    if mode == "challenge" and corrected_errors:
        raise TypingValidationError("corrections are not possible in challenge mode")
    if total_keystrokes < len(typed):
        # Every accepted character needs at least one keystroke/input event.
        total_keystrokes = len(typed)

    typed_chars = len(typed)
    error_positions = [i for i, ch in enumerate(typed) if ch != reference[i]]
    incorrect = len(error_positions)
    correct = typed_chars - incorrect
    minutes = elapsed_ms / 60000.0

    gross = (typed_chars / 5.0) / minutes
    if gross > MAX_PLAUSIBLE_GROSS_WPM:
        raise TypingValidationError("implausible typing speed; result rejected")
    net = max(0.0, gross - incorrect / minutes)
    accuracy = (correct / typed_chars * 100.0) if typed_chars else 0.0
    error_keystrokes = incorrect + max(0, corrected_errors)
    ks_acc = (
        max(0.0, (total_keystrokes - error_keystrokes) / total_keystrokes * 100.0) if total_keystrokes else None
    )
    return TypingMetrics(
        gross_wpm=round(gross, 2),
        net_wpm=round(net, 2),
        accuracy=round(accuracy, 2),
        keystroke_accuracy=round(ks_acc, 2) if ks_acc is not None else None,
        correct_chars=correct,
        incorrect_chars=incorrect,
        corrected_errors=max(0, corrected_errors),
        uncorrected_errors=incorrect,
        total_keystrokes=total_keystrokes,
        typed_chars=typed_chars,
        elapsed_ms=elapsed_ms,
        error_rate=round(incorrect / typed_chars * 100.0, 2) if typed_chars else 0.0,
        completed=typed_chars == len(reference),
        error_positions=error_positions,
    )


def typing_tips(m: TypingMetrics) -> list[str]:
    """Rule-based tips derived only from measured numbers."""
    tips: list[str] = []
    if m.typed_chars == 0:
        return ["No characters were typed. Start typing to get measurements."]
    if m.accuracy < 90:
        tips.append("Accuracy is below 90%. Slow down slightly and focus on hitting the correct key first time.")
    elif m.accuracy >= 98:
        tips.append("Excellent accuracy. You can try pushing your speed a little.")
    if m.corrected_errors > max(3, m.typed_chars * 0.05):
        tips.append("You corrected many mistakes. Try Challenge mode to practise getting it right first time.")
    if m.net_wpm < 25:
        tips.append("Practise home-row positioning and short daily sessions to build speed.")
    if not m.completed:
        tips.append("The passage was not finished. Complete the full text to compare results fairly.")
    return tips
