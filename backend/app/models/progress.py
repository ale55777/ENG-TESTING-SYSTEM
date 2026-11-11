from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin, new_uuid
from app.models.types import JSONType


class LearningRecommendation(TimestampMixin, Base):
    __tablename__ = "learning_recommendations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # reading | tongue_twister | ...
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ProgressSnapshot(TimestampMixin, Base):
    """Daily per-user aggregate, upserted after every completed attempt."""

    __tablename__ = "progress_snapshots"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_progress_user_day"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)


class Report(TimestampMixin, Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("practice_attempts.id", ondelete="CASCADE"), index=True
    )
    format: Mapped[str] = mapped_column(String(10), nullable=False)


class SystemErrorLog(Base):
    """Operational errors for admins. Never stores transcripts, audio or request bodies."""

    __tablename__ = "system_error_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    path: Mapped[str | None] = mapped_column(String(300))
    status_code: Mapped[int | None] = mapped_column(Integer)
    message: Mapped[str] = mapped_column(Text, nullable=False)
