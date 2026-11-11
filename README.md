# LinguaPractice — AI-Powered English Learning & Practice Platform

A web platform for practising English: **reading aloud** with word-by-word accuracy, **pronunciation**
drills scored from your audio, **tongue twisters**, **IELTS-style speaking** practice, and **typing**
tests with a strict no-correction mode. It includes progress tracking, personalised recommendations,
PDF/JSON/TXT reports and an admin panel.

> This is a learning and self-assessment tool. Scores are **practice estimates**, not official test
> results or certifications (including IELTS).

---

## Project status: what is done

**Status (Nov 2026): complete and running.** All modules work end to end with live Groq and Ably keys.
46 backend tests and 11 frontend unit tests pass. Typecheck is clean.

### Practice modules
| Module | What the learner does | What they get back |
|---|---|---|
| **Reading aloud** | Reads a passage (predefined or AI-generated) after optionally hearing it | Score right on the passage: word-matching %, "X of N words matched", every word colour-coded (matched / wrong / missing / extra), pronunciation score, pace, AI coaching |
| **Tongue twisters** | Says a twister, listening first if wanted | Same in-place score, plus *clear words per minute* (pace is only rated at ≥ 80% accuracy) |
| **Pronunciation** | Records drills or any custom word/sentence | Pronunciation score /100 shown in place, per-word acoustic confidence, "model heard…", a 🔊 button for each weak word |
| **Speaking (IELTS-style)** | Answers a prompt with prep and speaking timers | 0–9 practice estimates for fluency, pronunciation, grammar, vocabulary and coherence, with corrections and an improved answer |
| **Typing** | Practice mode, or strict no-correction challenge mode | Gross/net WPM, accuracy, keystroke accuracy, error rate (all recomputed on the server) |

### Platform features
* **Accounts:** register, login, logout and "log out everywhere", password change, optional reset by email.
  The first account becomes the admin.
* **Dashboard, progress charts, history,** and deterministic **recommendations** that show their evidence.
* **Reports:** download any attempt as PDF, JSON or TXT.
* **Admin panel** with aggregate statistics only (it cannot see learners' transcripts or results).
* **Privacy:** audio is never stored. You can delete single attempts, your whole history or your account.
* **Settings:** profile, learning level and goals, reference voice and speed, and a **microphone picker**.

### AI and speech stack (all verified working)
| Part | Technology | Where it runs |
|---|---|---|
| Speech-to-text (live + scoring) | Groq **Whisper large-v3-turbo** | GroqCloud (falls back to local wav2vec2 without a key) |
| Exercise generation, AI feedback, speaking language scores | Groq **GPT-OSS 20B** (strict JSON, streamed feedback) | GroqCloud |
| Reference voice (passages, single words, voice preview) | **Supertonic 3 TTS** | Locally, ONNX on CPU, cached |
| Pronunciation scoring | **wav2vec2-base-960h** with CTC forced alignment | Locally, ONNX int8 |
| Live updates (transcripts, progress, streamed feedback) | **Ably** realtime | Ably (HTTP polling fallback without a key) |
| Database | PostgreSQL 17 | Docker, `127.0.0.1:5433` |

### Change log for this session (Nov 11, 2026)
1. **Keys connected and verified live.** The Groq key works (both models are available, and transcription,
   generation and streaming were tested). The Ably key works.
2. **Fix: Ably publishing was rejected** (`40161 requires an identified client`). The backend now sends an
   `X-Ably-ClientId` header (`backend/app/realtime/ably.py`).
3. **Fix: every voice module failed** with *"Attempted to send an sync request with an AsyncClient
   instance"* (HTTP 503). The Whisper upload passed its form fields to httpx 0.28 as a list, which httpx
   sends as a raw synchronous body. They are now a dict (`backend/app/services/groq/client.py`). The
   regression test `backend/tests/test_groq_request.py` sends a real httpx request.
4. **New: microphone selection** in Settings → Microphone, used by all four voice modules.
   * Lists your devices and updates when you plug or unplug one. Includes a live **Test microphone** level meter.
   * Each recorder shows *"Microphone: … · Change"*.
   * If the chosen mic is missing, the app finds it again by name, otherwise uses the system default and shows a warning.
   * The choice is saved per browser, because device ids are per browser (`apps/web/src/lib/audio/mic-preference.ts`,
     `components/settings/microphone-settings.tsx`).
5. **New: score shown where the words are matched.** After an attempt, the exercise card turns into a
   score panel:
   * A score ring with a rating (Excellent / Good / Keep practising / Needs work) and "X of N words matched"
   * Counts of matched, wrong, missing and extra words
   * The passage, colour-coded word by word
   * A link to the full breakdown

   This applies to reading, tongue twisters and pronunciation (`components/practice/inline-score.tsx`).

### Known open items
* `tests/test_integration_real.py::test_groq_live` is always skipped, because `conftest.py` clears
  `GROQ_API_KEY`. The same checks were run by hand and passed.
* Next.js 16 prints dev-only "instant navigation" validation notices in `logs/frontend.err.log`. They are harmless.
* 10 older lint warnings (`react-hooks/set-state-in-effect`) remain. None of them are errors.

---

## Quick start (Windows)

```powershell
# 1. one-time setup: checks prerequisites, installs everything, downloads local models,
#    starts PostgreSQL in Docker, runs migrations, verifies the build
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 2. (optional) add cloud keys to .env  – see "Credentials" below

# 3. run
powershell -ExecutionPolicy Bypass -File scripts\start.ps1      # opens http://localhost:3000
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

Prerequisites: Windows 10/11, Python 3.12+, Node.js 20+, Docker Desktop (setup offers to install
missing tools with `winget`, only with your approval). About 3 GB of disk space and 8 GB RAM.

**The first account you register becomes the administrator.**

**Simplest way to run during development:** from the project root, run

```powershell
npm run dev        # PostgreSQL + backend (:8000, auto-reload) + website (:3000) in one terminal; Ctrl+C stops both
```

Root scripts also include `npm run start`, `npm run stop`, `npm run setup` and `npm test`.

`start.ps1 -Dev` runs both servers with hot reload in the background instead, with logs in `logs/`.

Before your first recording, open **Settings → Microphone**, allow access, pick your mic and press
**Test microphone**.

---

## What works with and without cloud credentials

| Capability | No keys (offline) | `GROQ_API_KEY` | `ABLY_API_KEY` |
|---|---|---|---|
| Accounts, dashboard, history, reports, admin | ✅ | ✅ | ✅ |
| Typing practice + strict challenge | ✅ | ✅ | ✅ |
| Predefined reading / twister / pronunciation / speaking exercises | ✅ | ✅ | ✅ |
| Reference audio (Supertonic TTS, local) | ✅ | ✅ | ✅ |
| Pronunciation scoring (local acoustic model) | ✅ | ✅ | ✅ |
| Speech-to-text | ⚠️ local wav2vec2 fallback (lower accuracy, no punctuation) | ✅ Groq Whisper | — |
| AI exercise generation | ❌ | ✅ GPT-OSS | — |
| AI coaching feedback | rule-based tips | ✅ streamed | ✅ live streaming |
| Speaking grammar / vocabulary / coherence | ❌ (marked unavailable) | ✅ | — |
| Live event streaming | HTTP polling fallback | — | ✅ |

When Groq is enabled, **audio is sent to GroqCloud** (an external service) for transcription. The UI says so
next to every recorder.

---

## Credentials

Keys live in the root `.env` and are read **only by the backend**. They are never exposed through
`NEXT_PUBLIC_*` variables or sent to the browser.

* **Groq**: create a key at <https://console.groq.com/keys> and set `GROQ_API_KEY=...`.
  Models used (verified against Groq's model list, Nov 2026): `openai/gpt-oss-20b` (generation and feedback,
  strict JSON-schema outputs) and `whisper-large-v3-turbo` (speech-to-text). You can override them with
  `GROQ_CHAT_MODEL` / `GROQ_STT_MODEL`. Groq's free tier has rate limits, and Whisper requests are billed
  with a 10-second minimum each. Usage is not unlimited.
* **Ably**: create an app at <https://ably.com/accounts>, then copy an API key (`appId.keyId:secret`) with
  publish/subscribe/history capability into `ABLY_API_KEY=...`. Apps whose channel rules require
  identified clients are supported, because the server publishes as client `linguapractice-server`.
* **Password reset by email** (optional): set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
  Without SMTP, the "forgot password" flow is hidden and the API returns 503.

`JWT_SECRET` is generated locally by `setup.ps1`. It is **required** when `APP_ENV=production`.

After editing `.env`, restart with `stop.ps1` then `start.ps1`. `setup.ps1` re-checks both keys
without printing them.

---

## Architecture

```
Browser (Next.js 16, React 19, Tailwind 4, shadcn/ui, Recharts)
  │  AudioWorklet mic capture → 16 kHz PCM WAV (encoded in-browser)
  │  HTTPS: REST + multipart audio uploads ───────────────┐
  │  Ably Realtime (subscribe-only JWT, own channel) ◄──┐ │
  ▼                                                     │ ▼
FastAPI backend (Python 3.12, SQLAlchemy 2 async, Alembic)
  ├─ Groq: Whisper STT, GPT-OSS generation/feedback (HTTPX)
  ├─ Supertonic 3 TTS  (local ONNX Runtime, cached WAVs)
  ├─ wav2vec2-base-960h int8 ONNX (local) → pronunciation + offline STT
  ├─ deterministic scoring: word alignment, WER, typing, fluency
  └─ Ably REST publisher (idempotent message ids) ──────┘
PostgreSQL 17 (Docker, 127.0.0.1:5433)
```

Raw microphone audio goes only browser → FastAPI. It is processed in memory and **never stored**. Ably
carries events (transcripts, progress, feedback deltas), never audio. Ably is not a recognizer or a
scorer.

---

## How things are measured

### Reading and tongue twisters — word matching
Deterministic Levenshtein alignment over normalized words: case, curly quotes, edge punctuation,
hyphen splits, and digits are spelled out ("3" = "three"). Contractions are **not** expanded
("don't" ≠ "do not"). Ties are broken match/substitution → deletion → insertion, so results are
reproducible.

* `WER = (S + D + I) / N` (N = reference words). It can exceed 1.
* **Word-matching accuracy** = `max(0, 1 − WER) × 100`. It is undefined (shown "—") when N = 0.
* A *repeated* word is an insertion equal to an adjacent spoken word. It still counts as an insertion.
* Colours: green matched, red substituted, orange missing, blue extra. Every word also has an icon
  and screen-reader text, so meaning never depends on colour alone.
* The reference text is **frozen** when you start: the server checks the exercise's content hash and
  rejects the attempt (409) if the text changed meanwhile.
* Whisper is **not** prompted with the reference text, because that would bias recognition and inflate
  accuracy.
* Tongue twisters report *clear words per minute* (correct words only), and only rate pace when accuracy is ≥ 80%.
  That way speed is never rewarded over intelligibility.

### Pronunciation (separate from word matching)
Pronunciation comes from an acoustic model, `wav2vec2-base-960h` (character-level CTC, int8 ONNX, run
locally):
1. CTC **forced alignment** (Viterbi) of the expected words to your audio.
2. Each character's peak posterior over its aligned frames. The word score is their geometric mean × 100.
3. Unconstrained decoding over the word's time span shows what the model "heard".

Score bands are ≥ 75 clear, 50–74 unclear, < 50 possibly mispronounced. This is **word-level only**:
the model has no phoneme inventory, so the app never reports phoneme-level results. It was trained on
LibriSpeech audiobooks, so strong accents can lower scores even when speech is intelligible. If the
model files are missing, pronunciation is marked *unavailable* and only word matching is shown.

Sanity check, measured with synthetic speech: when the audio matches the reference, every word scores
about 100. When the reference is changed ("English" → "French"), the substituted words drop to about
0 and the model reports what it heard ("english"). This test is
`tests/test_integration_real.py`.

### Live transcription (chunked, not streaming)
Groq documents no streaming speech-to-text endpoint, so live text uses **chunking**:
* An energy VAD in the browser segments speech (it closes a segment after 700 ms of silence or at 10 s).
* Each closed segment is uploaded once as `final`. While a segment is still open and longer than 1.2 s,
  a snapshot is uploaded as `partial` every 2.5 s, with at most one partial request in flight.
* Partials are replaced by newer partials and ignored after their segment's final (duplicate and
  out-of-order suppression).
* The live text is for display only. **Scoring uses one authoritative transcription of the complete
  recording**, with word timestamps.

### Typing
`minutes = elapsed_ms / 60000`, measured with `performance.now()` (monotonic) from the first accepted keystroke.

| Metric | Formula |
|---|---|
| Gross WPM | `(characters typed / 5) / minutes` |
| Net WPM | `max(0, gross − uncorrected errors / minutes)` |
| Accuracy | `correct chars / chars typed × 100` (final text) |
| Keystroke accuracy | `(keystrokes − error keystrokes) / keystrokes × 100` |
| Error rate | `uncorrected errors / chars typed × 100` |

Corrected errors (practice mode) do not reduce net WPM directly, since they already cost time. They
do reduce keystroke accuracy. The server recomputes every metric from the submitted text and rejects
implausible input (over 300 gross WPM, longer than the reference, or corrections in challenge mode).

**Challenge mode** is enforced in layers, not just by blocking Backspace:
* `beforeinput` cancels paste, drop, undo/redo, autocorrect replacement, cut and all deletions.
* Keydown blocks Backspace, Delete, arrow/Home/End keys and Ctrl/Cmd shortcuts.
* The caret is forced to the end on every selection change, and context menu, drag and drop are disabled.
* **Every** input change (including IME composition and mobile keyboards) is validated in
  `acceptInput()`: the accepted text must be an unchanged prefix of the new value, otherwise the
  change is reverted. That rule is unit-tested in `apps/web/src/lib/typing/engine.test.ts`.

### Speaking (IELTS-style)
| Dimension | Basis |
|---|---|
| Fluency | **Audio**: speech rate (first to last voiced frame) and long pauses (≥ 1.5 s), using a transparent heuristic in `services/speaking/fluency.py` |
| Pronunciation | **Audio**: acoustic clarity of the recognized words (the CTC method above). Score/100 × 9 |
| Grammar, vocabulary, coherence | **Transcript**: GPT-OSS with a strict JSON schema, given quoted corrections and an improved answer |

All are 0–9 practice estimates in 0.5 steps and are labelled as **not official IELTS bands**. Without
Groq, the language dimensions are marked unavailable rather than guessed.

### AI feedback rules
Deterministic numbers (counts, WER, timings, typing metrics, acoustic scores) are stored in
`attempt.metrics`. AI text is stored separately in `attempt.feedback` and cannot overwrite them. The
LLM receives the numbers read-only and is told not to invent or alter any figure. If AI feedback
fails, rule-based tips are saved instead, and the user can retry.

### Recommendations
These are deterministic, built only from your saved attempts: repeatedly missed words,
low-confidence words, twister/typing accuracy trends, speaking grammar and pauses, untried modules,
and inactivity. Each one states its evidence. No claims about overall proficiency are made.

---

## Realtime (Ably)

* `GET /api/v1/realtime/token` issues an HS256 Ably JWT (`kid` = key name, TTL 1 h). Its capability is
  `{"learner:<userId>": ["subscribe","history"]}`, and its clientId is the user id. Browsers cannot
  publish, and the API key never leaves the server.
* The backend publishes over Ably REST using **client-supplied message ids** (`<session>:<seq>`). Ably
  idempotent publishing makes retries safe.
* The client de-duplicates by event id, re-orders by `seq` within each session (with a 1.2 s gap timeout),
  and shows connection state.
* The HTTP API is the source of truth: result pages poll until feedback is final, so missed events
  are recovered after reconnects. Without Ably, polling alone is used.
* Events: `exercise.created`, `assessment.started`, `transcript.partial`, `transcript.final`,
  `assessment.progress`, `assessment.completed`, `feedback.delta`, `feedback.completed`, `error`.
  The remaining types in the spec (`practice.started`, `speech.detected`, `practice.ended`) are
  accepted by the publisher but are not emitted yet, because those states are local to the browser.
* AI text streaming uses Ably's documented *message-per-token* pattern, with deltas coalesced to about
  every 120 ms. Ably's `@ably/ai-transport` SDK (v0.x, JavaScript and Vercel-AI-oriented) is not used:
  its server side has no Python SDK, and its message-append primitives need mutable-message channel
  rules that are not confirmed over plain REST.

---

## Privacy and security

* Passwords are hashed with bcrypt (cost 12, pre-hashed above 72 bytes). Sessions use an httpOnly,
  SameSite=Lax cookie JWT. "Log out everywhere" works by bumping a token version.
* CSRF: mutating API calls require an `X-Requested-With` header, which forces a CORS preflight against
  the allow-listed origin.
* Role-based access: every `/admin` endpoint requires the admin role. Admins see **aggregate** usage
  only, not transcripts, results or feedback, and audio is never stored at all.
* Every attempt query is filtered by the owner's user id. Another user's attempt returns 404.
* Rate limits run in-process, using sliding windows per IP, per user, and stricter ones for AI,
  login and registration. Use Redis if you run several replicas.
* Uploads accept WAV/FLAC/OGG only, up to 15 MB and 180 s, decoded and validated server-side.
* Users can delete single attempts, their whole history, or their account (Settings → Privacy & data).
  The system error log stores no user content.
* In production, set `APP_ENV=production` and `COOKIE_SECURE=true`, serve over **HTTPS**, and put both
  apps behind a reverse proxy.

---

## Testing

```powershell
cd backend; .venv\Scripts\python -m pytest                 # 46 tests, Groq/Ably mocked, SQLite
cd backend; .venv\Scripts\python -m pytest -m integration  # real local models; + Groq if GROQ_API_KEY set
cd apps\web; npm test; npm run lint; npm run typecheck; npm run build
```

Backend coverage:
* word alignment (missing, extra, substituted and repeated words, WER > 1, empty reference, normalization)
* typing formulas and strict-mode validation
* CTC forced alignment, including the long-sequence overflow regression
* fluency pause detection, content policy and recommendations
* auth (register/login/logout, hashing, CSRF, admin RBAC, cross-user isolation) and rate limiting
* the reading end-to-end flow with Ably events and unique event ids
* the reference freeze, audio validation, and transcription network failure (502, nothing saved)
* the Groq Whisper request encoding: a real httpx multipart request carrying the file and all form fields
* AI feedback failure falling back to rules
* speaking estimates, typing, history, PDF/JSON/TXT export, progress, deletion and token scoping

---

## Measured performance (this dev machine: Windows 10, 8 GB RAM, CPU only)

* Supertonic: about 6–13 s to synthesize a 3-sentence paragraph on first request (includes model load).
  Cached replays are served in about 0.08 s.
* Reading assessment, end to end with offline STT and pronunciation scoring, on a 12 s recording: about 5.7 s.
* wav2vec2 scoring of 4 s of audio: about 1.2 s, including first-call warm-up.

* Groq (measured live on Nov 11, 2026): Whisper transcription of a 3-sentence clip took about 1.4 s, and
  GPT-OSS tongue-twister generation took about 1.0 s. Each API response reports `latency_ms`.

---

## Project structure

```
apps/web/                 Next.js app (App Router)
  src/app/(app)/...       authenticated pages: dashboard, practice/*, results, progress, history, settings, admin
  src/components/practice recorder, TTS player, word highlighting, in-place score panel, typing test, result views
  src/components/settings microphone picker + test meter
  src/lib/                api client, auth, Ably realtime, audio (worklet/VAD/WAV, mic preference), typing engine
  public/worklets/        AudioWorklet processor
backend/app/
  api/v1/                 auth, profile, exercises, assessments, attempts/progress/reports, tts, realtime, admin, health
  core/                   settings, security, deps (RBAC), rate limiting
  models/                 SQLAlchemy models   (migrations in backend/alembic)
  services/               groq, transcription, pronunciation, tts, reading, speaking, typing, scoring,
                          feedback, recommendations, reports
  realtime/               Ably tokens + publisher
  database/               session + idempotent seed (predefined offline exercises)
backend/tests/            pytest suite
infrastructure/           docker-compose.yml (PostgreSQL)
scripts/                  setup.ps1, start.ps1, stop.ps1
```

API docs (OpenAPI) are at <http://localhost:8000/api/docs> while the backend runs. All routes live under `/api/v1/`.

---

## Known limitations and unverified items

* **Groq and Ably have been verified against the live services** (Nov 11, 2026): transcription,
  generation, streaming and Ably publishing all work. A full browser session with every Ably event type
  has not been checked event by event.
* **Supertonic upstream is archived** (Supertone, Sep 2026). The pinned `supertonic==1.3.1` package and
  downloaded weights work offline, but receive no upstream fixes. Weights are licensed OpenRAIL-M
  (use restrictions apply, e.g. no impersonation), and the code is MIT.
* The pronunciation model is **word-level and accent-sensitive** (see above). Its license follows the
  upstream `facebook/wav2vec2-base-960h` model card. The ONNX export comes from `Xenova/wav2vec2-base-960h`,
  which does not state a license itself, so verify before commercial use.
* Without Groq, the offline recognizer is noticeably less accurate. For example, it heard
  "patience" as "patients", which lowers word-matching accuracy (the app explains this).
* Daily progress snapshots are grouped by UTC day.
* Audio retention is not implemented: audio is never stored, so there is no consent flow to manage
  yet. The `audio_retention_consent` profile field is reserved for it.
* Rate limiting is in-memory (single process).
