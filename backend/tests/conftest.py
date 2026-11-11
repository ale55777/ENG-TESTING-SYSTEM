"""Test configuration: isolated SQLite database, external APIs mocked (no network, no paid calls)."""
from __future__ import annotations

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="elp-test-")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp}/test.db"
os.environ["GROQ_API_KEY"] = ""
os.environ["ABLY_API_KEY"] = ""
os.environ["JWT_SECRET"] = "test-secret-0123456789-abcdefghijklmnop"
os.environ["APP_ENV"] = "test"
os.environ["TTS_CACHE_DIR"] = f"{_tmp}/tts"

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.core.ratelimit import limiter  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.seed import seed  # noqa: E402
from app.database.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def fresh_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await seed(db)
    limiter.reset()
    yield


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           headers={"X-Requested-With": "fetch"}) as c:
        yield c


async def register(client: AsyncClient, email: str = "admin@example.com", password: str = "secret123", name: str = "Ada") -> dict:
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password, "display_name": name})
    assert r.status_code == 201, r.text
    return r.json()["user"]


@pytest.fixture
def anyio_backend():
    return "asyncio"
