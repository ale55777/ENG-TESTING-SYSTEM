"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { Target } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSpeechRecorder } from "@/hooks/use-speech-recorder";
import { api, errorMessage } from "@/lib/api";
import type { Attempt, Exercise } from "@/lib/types";
import { AttemptResult } from "./attempt-result";
import { ExercisePicker } from "./exercise-picker";
import { InlineScore } from "./inline-score";
import { PrivacyNote } from "./privacy-note";
import { RecorderPanel } from "./recorder-panel";
import { SayWord, TtsPlayer } from "./tts-player";

const CUSTOM_RE = /^[A-Za-z0-9' ,.!?;:\-’]+$/;

export function PronunciationPractice() {
  const params = useSearchParams();
  const initialText = params.get("text") || "";
  const [mode, setMode] = useState<"exercise" | "custom">(initialText ? "custom" : "exercise");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [custom, setCustom] = useState(initialText);
  const [frozenText, setFrozenText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);
  const [scoredText, setScoredText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopping = useRef(false);
  const rec = useSpeechRecorder({ live: false, maxDurationMs: 60_000, onAutoStop: () => void stopAndAssess() });
  const busy = rec.state === "recording" || rec.state === "requesting" || submitting;

  const customClean = custom.trim().replace(/\s+/g, " ");
  const customValid = customClean.length > 0 && customClean.split(" ").length <= 40 && CUSTOM_RE.test(customClean);
  const target = mode === "exercise" ? exercise?.content ?? "" : customClean;
  const shownText = frozenText ?? target;

  async function start() {
    if (!target || (mode === "custom" && !customValid)) return;
    setError(null);
    setResult(null);
    setFrozenText(target);
    stopping.current = false;
    if (!(await rec.start())) setFrozenText(null);
  }

  async function stopAndAssess() {
    if (stopping.current) return;
    stopping.current = true;
    const out = await rec.stop();
    if (!out) return;
    if (!out.hasSpeech) {
      setError("No speech was detected. Check your microphone and try again.");
      setFrozenText(null);
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("audio", out.wav, "recording.wav");
    if (mode === "exercise" && exercise) {
      fd.append("exercise_id", exercise.id);
      fd.append("content_hash", exercise.content_hash);
    } else fd.append("custom_text", frozenText || customClean);
    fd.append("session_id", rec.sessionId);
    fd.append("started_at_ms", String(out.startedAtMs));
    try {
      const r = await api<{ attempt: Attempt }>("/assessments/pronunciation", { method: "POST", body: fd, timeoutMs: 120_000 });
      setResult(r.attempt);
      setScoredText(frozenText ?? target); // show the score in place on this text
    } catch (e) {
      setError(errorMessage(e));
      toast.error("Assessment failed. Please try again.");
    } finally {
      setSubmitting(false);
      setFrozenText(null);
    }
  }

  const words = shownText.split(/\s+/).map((w) => w.replace(/[^A-Za-z'’-]/g, "")).filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pronunciation practice"
        description="Say individual words, sentences or difficult sounds. Your audio is scored word by word by an acoustic model — separately from speech-to-text word matching."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>{mode === "exercise" ? exercise?.title ?? "Loading…" : "Your own words"}</CardTitle>
            {mode === "exercise" && exercise?.details.target_sounds && (
              <CardDescription className="flex flex-wrap items-center gap-2">
                <Target className="size-4 text-primary" aria-hidden /> Focus:
                {exercise.details.target_sounds.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {result && !busy && scoredText === shownText ? (
              <InlineScore attempt={result} primary="pronunciation" />
            ) : (
              <p className="text-2xl font-medium leading-relaxed">{shownText || <span className="text-muted-foreground">Type a word or sentence to practise.</span>}</p>
            )}
            {words.length > 0 && words.length <= 12 && (
              <div className="flex flex-wrap gap-2" aria-label="Hear individual words">
                {words.map((w, i) => (
                  <span key={i} className="inline-flex items-center gap-0.5 rounded-md border px-2 py-0.5 text-sm">
                    {w}
                    <SayWord word={w} />
                  </span>
                ))}
              </div>
            )}
            {shownText && <TtsPlayer text={shownText} label="Hear the reference" />}
            <RecorderPanel
              rec={rec}
              onStart={start}
              onStop={stopAndAssess}
              submitting={submitting}
              disabled={!target || (mode === "custom" && !customValid)}
              startLabel="Record my pronunciation"
              showLive={false}
            />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Pronunciation scoring runs on this app&apos;s server with a local model (wav2vec2, character-level CTC). It gives word-level confidence only — it does
              not diagnose individual phonemes.
            </p>
            <PrivacyNote />
          </CardContent>
        </Card>
        <Tabs value={mode} onValueChange={(v) => !busy && setMode(v as "exercise" | "custom")}>
          <TabsList className="w-full">
            <TabsTrigger value="exercise" disabled={busy}>
              Drills
            </TabsTrigger>
            <TabsTrigger value="custom" disabled={busy}>
              Custom text
            </TabsTrigger>
          </TabsList>
          <TabsContent value="exercise">
            <ExercisePicker type="pronunciation" selected={exercise} onSelect={setExercise} locked={busy} initialId={params.get("exercise")} allowGenerate={false} />
          </TabsContent>
          <TabsContent value="custom">
            <Card>
              <CardContent className="space-y-3 pt-6">
                <Label htmlFor="custom-text">Word or sentence (up to 40 words)</Label>
                <Input id="custom-text" value={custom} onChange={(e) => setCustom(e.target.value)} disabled={busy} maxLength={300} placeholder="e.g. thirty three thousand" aria-invalid={!!custom && !customValid} />
                {custom && !customValid && <p className="text-xs text-destructive">Use English letters and basic punctuation only (max 40 words).</p>}
                <div className="flex flex-wrap gap-2">
                  {["think", "world", "very well", "rural", "squirrel", "three free throws"].map((s) => (
                    <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => setCustom(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      {result && (
        <section id="result" aria-label="Results" className="scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Your results</h2>
          <AttemptResult attempt={result} onUpdate={setResult} onRetry={() => setResult(null)} />
        </section>
      )}
    </div>
  );
}
