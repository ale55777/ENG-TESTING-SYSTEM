from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, new_uuid
from app.models.types import JSONType


class PracticeAttempt(TimestampMixin, Base):
    """One completed (or failed) practice attempt. `reference_text` is frozen at start time."""

    __tablename__ = "practice_attempts"
    __table_args__ = (
        Index("ix_attempts_user_created", "user_id", "created_at"),
        Index("ix_attempts_user_type", "user_id", "exercise_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    exercise_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("exercises.id", ondelete="SET NULL"))
    exercise_type: Mapped[str] = mapped_column(String(30), nullable=False)
    difficulty: Mapped[str | None] = mapped_column(String(20))
    reference_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="completed", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Deterministic headline numbers (never written by the LLM).
    word_accuracy: Mapped[float | None] = mapped_column(Float)
    pronunciation_score: Mapped[float | None] = mapped_column(Float)
    typing_wpm: Mapped[float | None] = mapped_column(Float)
    typing_accuracy: Mapped[float | None] = mapped_column(Float)

    metrics: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    # AI-generated explanation text, kept separate from metrics.
    feedback: Mapped[dict | None] = mapped_column(JSONType)
    ai_metadata: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)

    transcript: Mapped[SpeechTranscript | None] = relationship(
        back_populates="attempt", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )
    alignment: Mapped[WordAlignment | None] = relationship(
        back_populates="attempt", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )
    pronunciation: Mapped[PronunciationAssessment | None] = relationship(
        back_populates="attempt", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )
    typing: Mapped[TypingResult | None] = relationship(
        back_populates="attempt", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )
    speaking: Mapped[SpeakingAssessment | None] = relationship(
        back_populates="attempt", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )


class SpeechTranscript(TimestampMixin, Base):
    __tablename__ = "speech_transcripts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("practice_attempts.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    words: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)  # [{word,start,end}]
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    audio_duration_s: Mapped[float | None] = mapped_column(Float)
    latency_ms: Mapped[int | None] = mapped_column(Integer)

    attempt: Mapped[PracticeAttempt] = relationship(back_populates="transcript")


class WordAlignment(TimestampMixin, Base):
    __tablename__ = "word_alignments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("practice_attempts.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    ops: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    reference_word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    correct: Mapped[int] = mapped_column(Integer, nullable=False)
    substitutions: Mapped[int] = mapped_column(Integer, nullable=False)
    deletions: Mapped[int] = mapped_column(Integer, nullable=False)
    insertions: Mapped[int] = mapped_column(Integer, nullable=False)
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False)
    wer: Mapped[float | None] = mapped_column(Float)

    attempt: Mapped[PracticeAttempt] = relationship(back_populates="alignment")


class PronunciationAssessment(TimestampMixin, Base):
    __tablename__ = "pronunciation_assessments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("practice_attempts.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    available: Mapped[bool] = mapped_column(Boolean, nullable=False)
    unavailable_reason: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(100))
    method: Mapped[str | None] = mapped_column(String(100))
    overall_score: Mapped[float | None] = mapped_column(Float)
    words: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)

    attempt: Mapped[PracticeAttempt] = relationship(back_populates="pronunciation")


class TypingResult(TimestampMixin, Base):
    __tablename__ = "typing_results"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("practice_attempts.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # practice | challenge
    gross_wpm: Mapped[float] = mapped_column(Float, nullable=False)
    net_wpm: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy: Mapped[float] = mapped_column(Float, nullable=False)
    correct_chars: Mapped[int] = mapped_column(Integer, nullable=False)
    incorrect_chars: Mapped[int] = mapped_column(Integer, nullable=False)
    corrected_errors: Mapped[int] = mapped_column(Integer, nullable=False)
    uncorrected_errors: Mapped[int] = mapped_column(Integer, nullable=False)
    total_keystrokes: Mapped[int] = mapped_column(Integer, nullable=False)
    typed_chars: Mapped[int] = mapped_column(Integer, nullable=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error_rate: Mapped[float] = mapped_column(Float, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    typed_text: Mapped[str] = mapped_column(Text, nullable=False)

    attempt: Mapped[PracticeAttempt] = relationship(back_populates="typing")


class SpeakingAssessment(TimestampMixin, Base):
    __tablename__ = "speaking_assessments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("practice_attempts.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    part: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    fluency: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)  # measured audio metrics
    pronunciation: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    language: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)  # grammar/vocab/coherence
    estimates: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)  # per-dimension 0-9 practice estimates
    notes: Mapped[str | None] = mapped_column(Text)

    attempt: Mapped[PracticeAttempt] = relationship(back_populates="speaking")
