"""Builds real httpx requests (no high-level mocks) so request-encoding bugs surface in tests.

Regression: passing multipart form fields as a list of tuples made httpx 0.28 send a raw sync body,
failing every transcription with "Attempted to send an sync request with an AsyncClient instance".
"""
import httpx
import pytest

from app.services.groq.client import GroqClient


@pytest.mark.asyncio
async def test_transcribe_sends_multipart_with_file_and_fields(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    from app.core.config import get_settings

    get_settings.cache_clear()
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read()
        seen["ctype"] = request.headers.get("content-type", "")
        seen["body"] = body
        return httpx.Response(200, json={"text": " hello world ", "words": [{"word": "hello", "start": 0, "end": 0.4}]})

    c = GroqClient()
    c._client = httpx.AsyncClient(base_url="https://groq.test/openai/v1", transport=httpx.MockTransport(handler))
    try:
        t = await c.transcribe(b"RIFFfakewav", prompt="ctx")
    finally:
        await c.aclose()
        get_settings.cache_clear()

    assert t.text == "hello world"
    assert seen["ctype"].startswith("multipart/form-data")
    body = seen["body"]
    assert b'name="file"; filename="audio.wav"' in body and b"RIFFfakewav" in body
    assert body.count(b'name="timestamp_granularities[]"') == 2
    for field in (b'name="model"', b'name="response_format"', b'name="prompt"'):
        assert field in body
