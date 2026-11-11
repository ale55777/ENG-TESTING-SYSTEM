export type Level = "beginner" | "intermediate" | "advanced";
export type ExerciseType = "reading" | "tongue_twister" | "pronunciation" | "speaking" | "typing";

export interface User {
  id: string;
  email: string;
  role: "learner" | "admin";
  display_name: string;
  proficiency_level: Level;
  learning_goals: string;
  audio_retention_consent: boolean;
  preferred_difficulty: Level;
  preferred_voice: string;
  playback_speed: number;
  daily_goal_minutes: number;
  created_at: string | null;
}

export interface Exercise {
  id: string;
  exercise_type: ExerciseType;
  difficulty: Level;
  title: string;
  content: string;
  details: {
    topic?: string;
    key_vocabulary?: string[];
    target_sounds?: string[];
    tip?: string;
    part?: number;
    bullet_points?: string[];
    prep_seconds?: number;
    speak_seconds?: number;
  };
  source: "predefined" | "ai";
  category: string | null;
  content_hash: string;
  ai_model: string | null;
  created_at: string | null;
}

export interface AlignmentOp {
  type: "correct" | "substitution" | "deletion" | "insertion";
  ref: string | null;
  hyp: string | null;
  ref_index: number | null;
  hyp_index: number | null;
  ref_display_index: number | null;
  repeated: boolean;
  start: number | null;
  end: number | null;
}

export interface PronWord {
  index: number;
  word: string;
  score: number | null;
  label: "good" | "unclear" | "likely_mispronounced" | "not_scored";
  start: number | null;
  end: number | null;
  heard: string | null;
}

export interface Feedback {
  status: "pending" | "ready" | "failed" | "unavailable";
  source?: "ai" | "rule-based" | "none";
  model?: string;
  text?: string;
  tips?: string[];
  ai_error?: string;
  language?: SpeakingLanguage;
}

export interface SpeakingLanguage {
  grammar: { estimate: number; summary: string; issues: { original: string; correction: string; explanation: string }[] };
  vocabulary: { estimate: number; summary: string; suggestions: { used: string; better_alternatives: string[]; why: string }[] };
  coherence: { estimate: number; summary: string; relevance_to_question: string };
  improved_answer: string;
  next_steps: string[];
}

export interface AttemptSummary {
  id: string;
  exercise_id: string | null;
  exercise_type: ExerciseType;
  difficulty: Level | null;
  reference_preview: string;
  status: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  word_accuracy: number | null;
  pronunciation_score: number | null;
  typing_wpm: number | null;
  typing_accuracy: number | null;
  speaking_overall: number | null;
  feedback_status: string;
  created_at: string;
}

export interface Attempt extends AttemptSummary {
  reference_text: string;
  metrics: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  feedback: Feedback | null;
  ai_metadata: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  disclaimer: string;
  transcript: { text: string; words: { word: string; start: number; end: number }[]; model: string; audio_duration_s: number; latency_ms: number } | null;
  alignment: {
    ops: AlignmentOp[];
    reference_word_count: number;
    correct: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    repetitions: number;
    wer: number | null;
  } | null;
  pronunciation: { available: boolean; unavailable_reason: string | null; model: string | null; method: string | null; overall_score: number | null; words: PronWord[] } | null;
  typing: {
    mode: "practice" | "challenge";
    gross_wpm: number;
    net_wpm: number;
    accuracy: number;
    correct_chars: number;
    incorrect_chars: number;
    corrected_errors: number;
    uncorrected_errors: number;
    total_keystrokes: number;
    typed_chars: number;
    elapsed_ms: number;
    error_rate: number;
    completed: boolean;
    typed_text: string;
  } | null;
  speaking: {
    part: number;
    question: string;
    fluency: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    pronunciation: { available: boolean; overall_score: number | null; low_confidence_words: string[]; method: string; unavailable_reason: string | null };
    language: SpeakingLanguage | Record<string, never>;
    estimates: Record<string, number | null>;
    notes: string;
  } | null;
}

export interface RealtimeEvent {
  v: number;
  event_id: string;
  session_id: string;
  seq: number;
  type: string;
  ts: number;
  payload: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const TYPE_LABEL: Record<ExerciseType, string> = {
  reading: "Reading aloud",
  tongue_twister: "Tongue twister",
  pronunciation: "Pronunciation",
  speaking: "Speaking",
  typing: "Typing",
};

export const TYPE_PATH: Record<ExerciseType, string> = {
  reading: "/practice/reading",
  tongue_twister: "/practice/tongue-twisters",
  pronunciation: "/practice/pronunciation",
  speaking: "/practice/speaking",
  typing: "/practice/typing",
};
