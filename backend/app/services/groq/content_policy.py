"""Validation for AI-generated exercise text before it is shown to learners or saved."""
from __future__ import annotations

import re

# Small conservative blocklist; admins can additionally flag/hide content in the admin panel.
_BLOCKED = {
    "fuck", "shit", "bitch", "cunt", "nigger", "faggot", "rape", "porn", "nazi", "kill yourself",
    "suicide", "cocaine", "heroin", "sex", "nude", "whore", "slut", "bastard", "terrorist",
}
_URL_RE = re.compile(r"https?://|www\.", re.I)


class ContentRejected(ValueError):
    pass


def check_text(text: str, *, min_words: int, max_words: int, field: str = "text") -> str:
    t = " ".join(text.split())
    if not t:
        raise ContentRejected(f"{field} is empty")
    words = t.split()
    if not (min_words <= len(words) <= max_words):
        raise ContentRejected(f"{field} has {len(words)} words; expected {min_words}-{max_words}")
    if _URL_RE.search(t):
        raise ContentRejected(f"{field} contains a URL")
    letters = [c for c in t if c.isalpha()]
    if not letters:
        raise ContentRejected(f"{field} has no letters")
    ascii_ratio = sum(c.isascii() for c in letters) / len(letters)
    if ascii_ratio < 0.97:
        raise ContentRejected(f"{field} does not look like English text")
    low = f" {t.lower()} "
    for bad in _BLOCKED:
        # Prefix match at a word start, so inflections ("...ing", "...ed") are caught too.
        if re.search(rf"\b{re.escape(bad)}", low):
            raise ContentRejected(f"{field} contains disallowed content")
    return t
