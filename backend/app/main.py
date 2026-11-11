from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import admin, assessments, attempts, auth, exercises, health, profile, realtime, tts
from app.core.config import get_settings
from app.core.ratelimit import limiter
from app.database.seed import seed
from app.database.session import SessionLocal
from app.models import SystemErrorLog
from app.realtime.ably import publisher
from app.services.groq.client import groq_client
from app.services.registry import ctc_model

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.effective_jwt_secret()  # fail fast in production without a secret
    try:
        async with SessionLocal() as db:
            n = await seed(db)
            if n:
                log.info("Seeded %d predefined exercises", n)
    except Exception:
        log.exception("Database seed failed - is PostgreSQL running and migrated? (alembic upgrade head)")
    # Warm the local acoustic model in the background so the first assessment is fast.
    asyncio.get_running_loop().run_in_executor(None, ctc_model.load)
    yield
    await groq_client.aclose()
    await publisher.aclose()


app = FastAPI(title="English Learning & Practice API", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.frontend_origin.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Requested-With", "Authorization"],
    expose_headers=["Content-Disposition", "X-TTS-Cache", "Retry-After"],
)

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # CSRF defence for cookie auth: mutating API calls must carry a custom header, which browsers
    # only allow cross-origin after a CORS preflight that our allow-list controls.
    if request.method in MUTATING and request.url.path.startswith("/api/") and request.headers.get("x-requested-with") != "fetch":
        return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
    ip = request.client.host if request.client else "unknown"
    try:
        limiter.check(f"ip:{ip}", settings.rate_limit_per_minute * 5)
    except HTTPException as exc:
        return JSONResponse({"detail": exc.detail}, status_code=429, headers=exc.headers)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if settings.cookie_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


async def _log_error(source: str, path: str, status_code: int | None, message: str) -> None:
    try:
        async with SessionLocal() as db:
            db.add(SystemErrorLog(created_at=datetime.now(timezone.utc), source=source, path=path[:300],
                                  status_code=status_code, message=message[:2000]))
            await db.commit()
    except Exception:
        log.exception("Could not persist error log")


@app.exception_handler(HTTPException)
async def http_exc(request: Request, exc: HTTPException):
    if exc.status_code in (502, 503, 504):
        await _log_error("upstream", request.url.path, exc.status_code, str(exc.detail))
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_exc(request: Request, exc: RequestValidationError):
    errs = [{"field": ".".join(str(p) for p in e.get("loc", [])[1:]), "message": e.get("msg")} for e in exc.errors()]
    msg = "; ".join(f"{e['field']}: {e['message']}" if e["field"] else e["message"] for e in errs)
    return JSONResponse({"detail": msg or "Invalid request", "errors": errs}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s", request.url.path)
    await _log_error("server", request.url.path, 500, f"{exc.__class__.__name__}: {str(exc)[:500]}")
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


API = "/api/v1"
for r in (health.router, auth.router, profile.router, exercises.router, assessments.router, attempts.router,
          tts.router, realtime.router, admin.router):
    app.include_router(r, prefix=API)
