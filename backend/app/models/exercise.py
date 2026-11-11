from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, new_uuid
from app.models.types import JSONType

EXERCISE_TYPES = ("reading", "tongue_twister", "pronunciation", "speaking", "typing")
DIFFICULTIES = ("beginner", "intermediate", "advanced")


class DifficultyLevel(TimestampMixin, Base):
    __tablename__ = "difficulty_levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tts_speed: Mapped[float] = mapped_column(default=1.0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ExerciseCategory(TimestampMixin, Base):
    __tablename__ = "exercise_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    exercise_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Exercise(TimestampMixin, Base):
    __tablename__ = "exercises"
    __table_args__ = (
        Index("ix_exercises_type_difficulty_status", "exercise_type", "difficulty", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    exercise_type: Mapped[str] = mapped_column(String(30), nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("exercise_categories.id", ondelete="SET NULL"))
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # type-specific data: topic, target_sounds, speaking part, prep/speak seconds, tips...
    details: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="predefined", nullable=False)  # predefined | ai
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)  # active | flagged | hidden
    flag_reason: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    ai_model: Mapped[str | None] = mapped_column(String(100))
    content_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    category: Mapped[ExerciseCategory | None] = relationship(lazy="selectin")
