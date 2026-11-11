"""SQLAlchemy ORM models. Importing this package registers every table on Base.metadata."""
from app.models.user import LearningPreference, PasswordResetToken, User, UserProfile
from app.models.exercise import DifficultyLevel, Exercise, ExerciseCategory
from app.models.attempt import (
    PracticeAttempt,
    PronunciationAssessment,
    SpeakingAssessment,
    SpeechTranscript,
    TypingResult,
    WordAlignment,
)
from app.models.progress import LearningRecommendation, ProgressSnapshot, Report, SystemErrorLog

__all__ = [
    "User",
    "UserProfile",
    "LearningPreference",
    "PasswordResetToken",
    "DifficultyLevel",
    "Exercise",
    "ExerciseCategory",
    "PracticeAttempt",
    "SpeechTranscript",
    "WordAlignment",
    "PronunciationAssessment",
    "TypingResult",
    "SpeakingAssessment",
    "LearningRecommendation",
    "ProgressSnapshot",
    "Report",
    "SystemErrorLog",
]
