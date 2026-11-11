"""Application settings loaded from environment variables / .env file.

Secrets (GROQ_API_KEY, ABLY_API_KEY, JWT_SECRET) live only on the backend.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_name: str = "LinguaPractice"

    database_url: str = "postgresql+asyncpg://english:english@localhost:5433/english_learning"

    jwt_secret: str = Field(default="", description="HMAC secret for session JWTs")
    jwt_expires_minutes: int = 60 * 12
    cookie_name: str = "elp_session"
    cookie_secure: bool = False  # set True behind HTTPS

    frontend_origin: str = "http://localhost:3000"

    # Groq
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_chat_model: str = "openai/gpt-oss-20b"
    groq_chat_model_large: str = "openai/gpt-oss-120b"
    groq_stt_model: str = "whisper-large-v3-turbo"
    groq_timeout_seconds: float = 60.0

    # Ably
    ably_api_key: str = ""
    ably_rest_url: str = "https://rest.ably.io"
    ably_token_ttl_seconds: int = 3600

    # Local models
    supertonic_model_path: str = str(BACKEND_DIR / "models" / "supertonic3")
    supertonic_auto_download: bool = False
    pronunciation_model_path: str = str(BACKEND_DIR / "models" / "wav2vec2-base-960h")
    tts_cache_dir: str = str(BACKEND_DIR / "data" / "tts_cache")

    # Uploads / limits
    max_audio_upload_bytes: int = 15 * 1024 * 1024
    max_audio_seconds: float = 180.0
    rate_limit_per_minute: int = 60
    ai_rate_limit_per_minute: int = 20

    # Email (password reset). Optional.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @field_validator("supertonic_model_path", "pronunciation_model_path", "tts_cache_dir")
    @classmethod
    def _resolve_path(cls, v: str) -> str:
        p = Path(v).expanduser()
        return str(p if p.is_absolute() else (REPO_ROOT / p).resolve())

    @property
    def groq_configured(self) -> bool:
        return bool(self.groq_api_key.strip())

    @property
    def ably_configured(self) -> bool:
        return ":" in self.ably_api_key and "." in self.ably_api_key.split(":")[0]

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    def effective_jwt_secret(self) -> str:
        if self.jwt_secret:
            return self.jwt_secret
        if self.is_production:
            raise RuntimeError("JWT_SECRET must be set in production")
        # Development fallback: stable per machine run, never used in production.
        return "dev-only-insecure-secret-change-me"


@lru_cache
def get_settings() -> Settings:
    return Settings()
