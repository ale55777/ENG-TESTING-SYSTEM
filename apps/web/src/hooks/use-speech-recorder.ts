"use client";

/**
 * Recording + chunked live transcription.
 *
 * Groq Whisper has no streaming endpoint, so live text is produced by chunking:
 *   - every closed VAD segment is uploaded once as kind=final,
 *   - while a segment is open and > 1.2 s long, a snapshot is uploaded as kind=partial every ~2.5 s
 *     (never more than one partial request in flight).
 * Partial results for a segment are replaced by newer partials and ignored once its final arrives
 * (duplicate/out-of-order suppression). The live transcript is display-only: scoring uses one
 * authoritative transcription of the complete recording, made by the assessment endpoint.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { MicRecorder, micErrorMessage } from "@/lib/audio/recorder";
import { encodeWav, TARGET_SR } from "@/lib/audio/wav";

export type RecState = "idle" | "requesting" | "recording" | "stopping" | "error";

interface Segment {
  index: number;
  text: string;
  final: boolean;
  t: number; // monotonic receive time
}

export function newSessionId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function useSpeechRecorder(opts: { live?: boolean; maxDurationMs?: number; onAutoStop?: () => void } = {}) {
  const live = opts.live ?? true;
  const [state, setState] = useState<RecState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [segments, setSegments] = useState<Record<number, Segment>>({});
  const [liveError, setLiveError] = useState<string | null>(null);
  const [mic, setMic] = useState<{ label: string; fellBack: boolean } | null>(null);
  const recRef = useRef<MicRecorder | null>(null);
  const sessionRef = useRef<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const startedAtRef = useRef<number>(0);
  const perfStartRef = useRef<number>(0);
  const partialInFlight = useRef(false);
  const timers = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const autoStopRef = useRef<(() => void) | null>(null);

  const applyResult = useCallback((index: number, text: string, final: boolean) => {
    setSegments((prev) => {
      const cur = prev[index];
      if (cur?.final && !final) return prev; // stale partial after final
      if (cur && cur.text === text && cur.final === final) return prev; // duplicate
      return { ...prev, [index]: { index, text, final, t: performance.now() } };
    });
  }, []);

  const sendChunk = useCallback(
    async (samples: Float32Array, index: number, kind: "partial" | "final") => {
      if (!live || samples.length < TARGET_SR * 0.25) return;
      const fd = new FormData();
      fd.append("audio", encodeWav(samples), "chunk.wav");
      fd.append("session_id", sessionRef.current);
      fd.append("segment_index", String(index));
      fd.append("kind", kind);
      try {
        const r = await api<{ text: string }>("/speech/transcribe-chunk", {
          method: "POST",
          body: fd,
          timeoutMs: 30_000,
          signal: abortRef.current?.signal,
        });
        applyResult(index, r.text, kind === "final");
        setLiveError(null);
      } catch (e) {
        if (abortRef.current?.signal.aborted) return;
        setLiveError("Live transcript is delayed: " + errorMessage(e) + " Your recording continues and will still be assessed.");
      }
    },
    [live, applyResult],
  );

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearInterval(t));
    timers.current = [];
  };

  const start = useCallback(async () => {
    setError(null);
    setLiveError(null);
    setSegments({});
    setElapsedMs(0);
    setSpeechDetected(false);
    const sid = newSessionId();
    sessionRef.current = sid;
    setSessionId(sid);
    abortRef.current = new AbortController();
    if (!MicRecorder.supported()) {
      setError("Your browser does not support microphone recording. Use a recent Chrome, Edge, Firefox or Safari.");
      setState("error");
      return false;
    }
    setState("requesting");
    const rec = new MicRecorder(
      {
        onLevel: (rms, sp) => {
          setLevel(Math.min(1, rms * 12));
          setSpeaking(sp);
        },
        onSpeechStart: () => setSpeechDetected(true),
        onSegmentClosed: (seg) => {
          const r = recRef.current;
          if (r) void sendChunk(r.slice16k(seg.startSample, seg.endSample), seg.index, "final");
        },
        onMaxDuration: () => {
          const fn = autoStopRef.current;
          autoStopRef.current = null; // fire once
          fn?.();
        },
      },
      { maxDurationMs: opts.maxDurationMs ?? 180_000 },
    );
    try {
      await rec.start();
    } catch (e) {
      setError(micErrorMessage(e));
      setState("error");
      return false;
    }
    recRef.current = rec;
    setMic({ label: rec.deviceLabel, fellBack: rec.usedFallback });
    startedAtRef.current = Date.now();
    perfStartRef.current = performance.now();
    setState("recording");
    timers.current.push(window.setInterval(() => setElapsedMs(performance.now() - perfStartRef.current), 200));
    if (live) {
      timers.current.push(
        window.setInterval(() => {
          const r = recRef.current;
          const seg = r?.openSegment();
          if (!r || !seg || partialInFlight.current) return;
          if ((seg.endSample - seg.startSample) / r.sampleRate < 1.2) return;
          partialInFlight.current = true;
          void sendChunk(r.slice16k(seg.startSample, seg.endSample), seg.index, "partial").finally(() => {
            partialInFlight.current = false;
          });
        }, 2500),
      );
    }
    return true;
  }, [live, sendChunk, opts.maxDurationMs]);

  /** Stop and return the complete 16 kHz WAV recording. */
  const stop = useCallback(async (): Promise<{ wav: Blob; durationMs: number; hasSpeech: boolean; startedAtMs: number } | null> => {
    const rec = recRef.current;
    if (!rec) return null;
    setState("stopping");
    clearTimers();
    const hasSpeech = rec.hasSpeech;
    const samples = await rec.stop();
    recRef.current = null;
    setLevel(0);
    setSpeaking(false);
    setState("idle");
    return { wav: encodeWav(samples), durationMs: (samples.length / TARGET_SR) * 1000, hasSpeech, startedAtMs: startedAtRef.current };
  }, []);

  const cancel = useCallback(async () => {
    clearTimers();
    abortRef.current?.abort();
    await recRef.current?.cancel();
    recRef.current = null;
    setSegments({});
    setLevel(0);
    setState("idle");
  }, []);

  useEffect(() => {
    autoStopRef.current = opts.onAutoStop ?? null;
  });

  useEffect(
    () => () => {
      clearTimers();
      abortRef.current?.abort();
      void recRef.current?.cancel();
    },
    [],
  );

  const liveText = Object.values(segments)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.text)
    .filter(Boolean)
    .join(" ");
  const hasPartial = Object.values(segments).some((s) => !s.final);

  return {
    state,
    error,
    liveError,
    level,
    speaking,
    speechDetected,
    elapsedMs,
    liveText,
    hasPartial,
    sessionId,
    /** Microphone used by the current/last recording (null before the first one). */
    mic,
    start,
    stop,
    cancel,
  };
}
