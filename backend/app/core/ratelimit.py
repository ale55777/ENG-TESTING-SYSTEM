"""In-process sliding-window rate limiter.

Suitable for a single backend process (the default deployment). For multiple
replicas, replace with a shared store such as Redis.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, status


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_s: float = 60.0) -> None:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > window_s:
            q.popleft()
        if len(q) >= limit:
            retry = max(1, int(window_s - (now - q[0])))
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down.",
                headers={"Retry-After": str(retry)},
            )
        q.append(now)

    def reset(self) -> None:
        self._hits.clear()


limiter = RateLimiter()
