"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRaw, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"];
const SPEEDS = [0.8, 0.9, 1.0, 1.1, 1.25];

// In-memory cache of generated audio blobs for this browser tab (the server also caches on disk).
const blobCache = new Map<string, string>();

async function fetchTts(text: string, voice: string, speed: number): Promise<string> {
  const key = `${voice}|${speed}|${text}`;
  const hit = blobCache.get(key);
  if (hit) return hit;
  const res = await apiRaw("/tts", { method: "POST", body: { text, voice, speed }, timeoutMs: 90_000 });
  const url = URL.createObjectURL(await res.blob());
  blobCache.set(key, url);
  return url;
}

/** Full player: play/pause/resume/stop, voice and speed selection. */
export function TtsPlayer({ text, label = "Listen to reference", compact = false }: { text: string; label?: string; compact?: boolean }) {
  const { user } = useAuth();
  const [voice, setVoice] = useState(user?.preferred_voice || "F1");
  const [speed, setSpeed] = useState(user?.playback_speed || 1.0);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
  }, [text, voice, speed]);

  async function play() {
    setError(null);
    if (audioRef.current && state === "paused") {
      await audioRef.current.play();
      setState("playing");
      return;
    }
    setState("loading");
    try {
      const url = await fetchTts(text, voice, speed);
      const a = new Audio(url);
      a.onended = () => setState("idle");
      a.onerror = () => {
        setError("Audio playback failed.");
        setState("idle");
      };
      audioRef.current = a;
      await a.play();
      setState("playing");
    } catch (e) {
      setError(errorMessage(e));
      setState("idle");
    }
  }

  function pause() {
    audioRef.current?.pause();
    setState("paused");
  }
  function stop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setState("idle");
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact && "gap-1")}>
      {state === "playing" ? (
        <Button variant="secondary" size={compact ? "sm" : "default"} onClick={pause}>
          <Pause /> Pause
        </Button>
      ) : (
        <Button variant="secondary" size={compact ? "sm" : "default"} onClick={play} disabled={state === "loading" || !text}>
          {state === "loading" ? <Loader2 className="animate-spin" /> : state === "paused" ? <Play /> : <Volume2 />}
          {state === "loading" ? "Generating audio…" : state === "paused" ? "Resume" : label}
        </Button>
      )}
      {(state === "playing" || state === "paused") && (
        <Button variant="ghost" size={compact ? "sm" : "default"} onClick={stop} aria-label="Stop playback">
          <Square /> Stop
        </Button>
      )}
      {!compact && (
        <>
          <Select value={voice} onValueChange={setVoice}>
            <SelectTrigger className="w-28" aria-label="Reference voice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICES.map((v) => (
                <SelectItem key={v} value={v}>
                  Voice {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
            <SelectTrigger className="w-24" aria-label="Playback speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEEDS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      {error && (
        <p className="w-full text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Small icon button that pronounces a single word. */
export function SayWord({ word }: { word: string }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Hear "${word}"`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const url = await fetchTts(word, user?.preferred_voice || "F1", 0.9);
          await new Audio(url).play();
        } catch {
          /* errors are non-critical for single words */
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Volume2 />}
    </Button>
  );
}
