"""Groq API client (OpenAI-compatible endpoints) for GPT-OSS chat and Whisper transcription.

Verified against Groq docs (Nov 2026):
  * chat:  POST /openai/v1/chat/completions, models openai/gpt-oss-20b|120b,
           response_format json_schema with strict=true (no streaming with structured outputs),
           reasoning_effort low|medium|high, include_reasoning bool.
  * audio: POST /openai/v1/audio/transcriptions, whisper-large-v3-turbo,
           response_format=verbose_json + timestamp_granularities[]=word|segment.
           No streaming transcription is documented; we transcribe uploaded chunks.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)


class GroqError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


class GroqNotConfigured(GroqError):
    def __init__(self) -> None:
        super().__init__("GROQ_API_KEY is not configured on the server", 503)


@dataclass
class Transcription:
    text: str
    words: list[dict]
    segments: list[dict]
    language: str
    duration_s: float | None
    model: str
    latency_ms: int


class GroqClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        s = get_settings()
        if not s.groq_configured:
            raise GroqNotConfigured()
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=s.groq_base_url,
                headers={"Authorization": f"Bearer {s.groq_api_key}"},
                timeout=httpx.Timeout(s.groq_timeout_seconds, connect=10.0),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def _request(self, method: str, url: str, *, attempts: int = 3, **kw) -> httpx.Response:
        delay = 1.0
        last: Exception | None = None
        for i in range(attempts):
            try:
                r = await self._http().request(method, url, **kw)
            except httpx.TimeoutException as exc:
                last = GroqError("Groq request timed out", 504, retryable=True)
                last.__cause__ = exc
            except httpx.TransportError as exc:
                last = GroqError(f"Network error contacting Groq: {exc.__class__.__name__}", 502, retryable=True)
            else:
                if r.status_code < 400:
                    return r
                retryable = r.status_code == 429 or r.status_code >= 500
                try:
                    msg = r.json().get("error", {}).get("message", r.text[:300])
                except Exception:
                    msg = r.text[:300]
                last = GroqError(f"Groq API error {r.status_code}: {msg}", r.status_code, retryable)
                if not retryable:
                    raise last
                ra = r.headers.get("retry-after")
                if ra:
                    try:
                        delay = min(10.0, float(ra))
                    except ValueError:
                        pass
            if i < attempts - 1:
                await asyncio.sleep(delay)
                delay *= 2
        assert last is not None
        raise last

    # ---------- chat ----------
    async def chat_json(
        self,
        messages: list[dict],
        schema_name: str,
        schema: dict,
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        reasoning_effort: str = "low",
    ) -> tuple[dict, dict]:
        """Strict structured output. Returns (parsed_json, metadata)."""
        s = get_settings()
        model = model or s.groq_chat_model
        body = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_completion_tokens": max_tokens,
            "reasoning_effort": reasoning_effort,
            "include_reasoning": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
        }
        t0 = time.perf_counter()
        r = await self._request("POST", "/chat/completions", json=body)
        data = r.json()
        content = data["choices"][0]["message"].get("content") or ""
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise GroqError("Model returned invalid JSON", 502) from exc
        meta = {
            "provider": "groq",
            "model": data.get("model", model),
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "usage": data.get("usage", {}),
        }
        return parsed, meta

    async def chat_stream(
        self,
        messages: list[dict],
        *,
        model: str | None = None,
        temperature: float = 0.5,
        max_tokens: int = 1200,
        reasoning_effort: str = "low",
    ) -> AsyncIterator[str]:
        s = get_settings()
        body = {
            "model": model or s.groq_chat_model,
            "messages": messages,
            "temperature": temperature,
            "max_completion_tokens": max_tokens,
            "reasoning_effort": reasoning_effort,
            "include_reasoning": False,
            "stream": True,
        }
        async with self._http().stream("POST", "/chat/completions", json=body) as r:
            if r.status_code >= 400:
                text = (await r.aread()).decode(errors="ignore")[:300]
                raise GroqError(f"Groq API error {r.status_code}: {text}", r.status_code, r.status_code >= 500)
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {}).get("content")
                if delta:
                    yield delta

    # ---------- speech ----------
    async def transcribe(self, wav_bytes: bytes, *, prompt: str | None = None, word_timestamps: bool = True) -> Transcription:
        s = get_settings()
        # Must be a dict: httpx 0.28 treats a list of tuples as a raw *sync* body (dropping the file),
        # which AsyncClient rejects with "Attempted to send an sync request". Repeated fields use list values.
        data: dict[str, str | list[str]] = {
            "model": s.groq_stt_model,
            "language": "en",
            "temperature": "0",
            "response_format": "verbose_json",
        }
        if word_timestamps:
            data["timestamp_granularities[]"] = ["word", "segment"]
        if prompt:
            data["prompt"] = prompt[:600]
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        t0 = time.perf_counter()
        r = await self._request("POST", "/audio/transcriptions", data=data, files=files)
        j = r.json()
        words = [
            {"word": w.get("word", ""), "start": w.get("start"), "end": w.get("end")}
            for w in (j.get("words") or [])
        ]
        segs = [
            {"text": sg.get("text", ""), "start": sg.get("start"), "end": sg.get("end"),
             "no_speech_prob": sg.get("no_speech_prob"), "avg_logprob": sg.get("avg_logprob")}
            for sg in (j.get("segments") or [])
        ]
        return Transcription(
            text=(j.get("text") or "").strip(),
            words=words,
            segments=segs,
            language=j.get("language") or "en",
            duration_s=j.get("duration"),
            model=s.groq_stt_model,
            latency_ms=int((time.perf_counter() - t0) * 1000),
        )

    async def health(self) -> dict:
        s = get_settings()
        if not s.groq_configured:
            return {"configured": False, "ok": False, "detail": "GROQ_API_KEY not set"}
        t0 = time.perf_counter()
        try:
            r = await self._request("GET", "/models", attempts=1)
            ids = {m.get("id") for m in r.json().get("data", [])}
            return {
                "configured": True,
                "ok": True,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "chat_model_available": s.groq_chat_model in ids,
                "stt_model_available": s.groq_stt_model in ids,
            }
        except GroqError as exc:
            return {"configured": True, "ok": False, "detail": str(exc)}


groq_client = GroqClient()
