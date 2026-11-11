"""Ably realtime events (server side).

* Tokens: short-lived Ably JWTs signed with the API key secret (HS256, header `kid` = key name),
  with capability limited to the user's own channel and `subscribe`/`history` only. The browser
  never sees the API key and cannot publish.
* Publishing: Ably REST `POST /channels/{name}/messages` with client-supplied message ids
  (idempotent publishing => safe retries without duplicates).
* Streaming AI text uses the message-per-token pattern documented for Ably AI Transport:
  deltas are coalesced (~120 ms) and every event carries `session_id` + monotonically increasing
  `seq` so the client can order and de-duplicate, and recover via the HTTP API after reconnects.

Raw microphone audio is never sent through Ably; it goes browser -> FastAPI over HTTPS.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from urllib.parse import quote

import httpx
import jwt

from app.core.config import get_settings

log = logging.getLogger(__name__)

EVENT_TYPES = {
    "exercise.created",
    "practice.started",
    "speech.detected",
    "transcript.partial",
    "transcript.final",
    "assessment.started",
    "assessment.progress",
    "assessment.completed",
    "feedback.delta",
    "feedback.completed",
    "practice.ended",
    "error",
}


def user_channel(user_id: uuid.UUID | str) -> str:
    return f"learner:{user_id}"


def create_token(user_id: uuid.UUID | str) -> dict:
    s = get_settings()
    if not s.ably_configured:
        raise RuntimeError("ABLY_API_KEY is not configured")
    key_name, key_secret = s.ably_api_key.split(":", 1)
    now = int(time.time())
    ttl = max(300, min(s.ably_token_ttl_seconds, 86400))
    capability = {user_channel(user_id): ["subscribe", "history"]}
    claims = {
        "iat": now,
        "exp": now + ttl,
        "x-ably-capability": json.dumps(capability),
        "x-ably-clientId": str(user_id),
    }
    token = jwt.encode(claims, key_secret, algorithm="HS256", headers={"kid": key_name, "typ": "JWT"})
    return {"token": token, "expires_at": now + ttl, "channel": user_channel(user_id), "client_id": str(user_id)}


class AblyPublisher:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self.last_error: str | None = None
        self.published = 0
        self.failed = 0

    def _http(self) -> httpx.AsyncClient:
        s = get_settings()
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=s.ably_rest_url,
                auth=tuple(s.ably_api_key.split(":", 1)),
                # Identify the server as a client: Ably apps whose channel rules require identified
                # clients reject anonymous basic-auth publishes with 40161.
                headers={"X-Ably-ClientId": base64.b64encode(b"linguapractice-server").decode()},
                timeout=httpx.Timeout(8.0, connect=5.0),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    @property
    def enabled(self) -> bool:
        return get_settings().ably_configured

    async def publish(self, user_id: uuid.UUID | str, event_type: str, payload: dict, *, session_id: str, seq: int) -> str | None:
        """Publish one event. Never raises: realtime delivery is best-effort; HTTP APIs are the source of truth."""
        if event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event type {event_type}")
        event_id = f"{session_id}:{seq}"
        if not self.enabled:
            return None
        msg = {
            "id": event_id,
            "name": event_type,
            "data": {"v": 1, "event_id": event_id, "session_id": session_id, "seq": seq, "type": event_type,
                     "ts": int(time.time() * 1000), "payload": payload},
        }
        path = f"/channels/{quote(user_channel(user_id), safe='')}/messages"
        for attempt in range(3):
            try:
                r = await self._http().post(path, json=msg)
                if r.status_code < 300:
                    self.published += 1
                    return event_id
                if r.status_code < 500 and r.status_code != 429:
                    self.last_error = f"Ably publish {r.status_code}: {r.text[:200]}"
                    break
            except httpx.HTTPError as exc:
                self.last_error = f"Ably network error: {exc.__class__.__name__}"
            await asyncio.sleep(0.3 * (2**attempt))
        self.failed += 1
        log.warning("Ably publish failed: %s", self.last_error)
        return None

    async def health(self) -> dict:
        s = get_settings()
        if not s.ably_configured:
            return {"configured": False, "ok": False, "detail": "ABLY_API_KEY not set (realtime updates disabled; app falls back to HTTP polling)"}
        t0 = time.perf_counter()
        try:
            r = await self._http().get("/time")
            ok = r.status_code < 300
            return {"configured": True, "ok": ok, "latency_ms": int((time.perf_counter() - t0) * 1000),
                    "published": self.published, "failed": self.failed, "last_error": self.last_error,
                    **({} if ok else {"detail": f"HTTP {r.status_code}"})}
        except httpx.HTTPError as exc:
            return {"configured": True, "ok": False, "detail": f"{exc.__class__.__name__}"}


publisher = AblyPublisher()


class EventSession:
    """Sequenced event stream for one practice session."""

    def __init__(self, user_id: uuid.UUID | str, session_id: str | None = None) -> None:
        self.user_id = user_id
        self.session_id = session_id or uuid.uuid4().hex
        self._seq = 0

    async def emit(self, event_type: str, payload: dict | None = None) -> str:
        self._seq += 1
        seq = self._seq
        event_id = f"{self.session_id}:{seq}"
        await publisher.publish(self.user_id, event_type, payload or {}, session_id=self.session_id, seq=seq)
        return event_id


class DeltaCoalescer:
    """Buffers streamed text and flushes as feedback.delta events at most every `interval` seconds."""

    def __init__(self, session: EventSession, attempt_id: str, interval: float = 0.12, max_chars: int = 240) -> None:
        self.session = session
        self.attempt_id = attempt_id
        self.interval = interval
        self.max_chars = max_chars
        self._buf: list[str] = []
        self._last = time.monotonic()
        self.full: list[str] = []

    async def add(self, text: str) -> None:
        self._buf.append(text)
        self.full.append(text)
        if time.monotonic() - self._last >= self.interval or sum(map(len, self._buf)) >= self.max_chars:
            await self.flush()

    async def flush(self) -> None:
        if not self._buf:
            return
        chunk = "".join(self._buf)
        self._buf.clear()
        self._last = time.monotonic()
        await self.session.emit("feedback.delta", {"attempt_id": self.attempt_id, "delta": chunk})
