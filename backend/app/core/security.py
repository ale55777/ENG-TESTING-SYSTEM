"""Password hashing (bcrypt) and session JWTs (HS256)."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import get_settings

_ALGO = "HS256"


def hash_password(password: str) -> str:
    # bcrypt only uses the first 72 bytes; pre-hash longer inputs so they are not silently truncated.
    pw = password.encode("utf-8")
    if len(pw) > 72:
        pw = hashlib.sha256(pw).hexdigest().encode()
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    pw = password.encode("utf-8")
    if len(pw) > 72:
        pw = hashlib.sha256(pw).hexdigest().encode()
    try:
        return bcrypt.checkpw(pw, password_hash.encode())
    except ValueError:
        return False


def create_session_token(user_id: uuid.UUID, role: str, token_version: int) -> tuple[str, datetime]:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(minutes=s.jwt_expires_minutes)
    payload = {"sub": str(user_id), "role": role, "tv": token_version, "exp": exp, "typ": "session"}
    return jwt.encode(payload, s.effective_jwt_secret(), algorithm=_ALGO), exp


def decode_session_token(token: str) -> dict | None:
    try:
        data = jwt.decode(token, get_settings().effective_jwt_secret(), algorithms=[_ALGO])
    except jwt.PyJWTError:
        return None
    if data.get("typ") != "session":
        return None
    return data


def new_reset_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()


def hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
