"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Hourglass, Info, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSpeechRecorder } from "@/hooks/use-speech-recorder";
import { api, errorMessage } from "@/lib/api";
import type { Attempt, Exercise } from "@/lib/types";
import { AttemptResult } from "./attempt-result";
import { ExercisePicker } from "./exercise-picker";
import { PrivacyNote } from "./privacy-note";
import { formatMs, RecorderPanel } from "./recorder-panel";

const PART_INFO: Record<number, string> = {
  1: "Part 1 — short answers about familiar topics (about 30–45 seconds).",
  2: "Part 2 — a long turn: 1 minute to prepare, then speak for up to 2 minutes.",
  3: "Part 3 — discussion: give extended answers with reasons and examples (about 1–1.5 minutes).",
};

export function SpeakingPractice() {
  const params = useSearchParams();
  const [part, setPart] = useState(Number(params.get("part")) || 1);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [frozen, setFrozen] = useState<Exercise | null>(null);
  const [prepLeft, setPrepLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopping = useRef(false);
  const speakMs = ((frozen ?? exercise)?.details.speak_seconds ?? 60) * 1000;
  const rec = useSpeechRecorder({ live: true, maxDurationMs: speakMs, onAutoStop: () => void stopAndAssess() });
  const busy = rec.state === "recording" || rec.state === "requesting" || submitting || prepLeft !== null;
  const shown = frozen ?? exercise;

  async function beginSpeaking() {
    if (!(await rec.start())) setFrozen(null);
  }

  useEffect(() => {
    if (prepLeft === null) return;
    if (prepLeft <= 0) {
      setPrepLeft(null);
      void beginSpeaking();
      return;
    }
    const t = setTimeout(() => setPrepLeft((p) => (p === null ? null : p - 1)), 1000);
    return () => clearTimeout(t);
  }, [prepLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    if (!exercise) return;
    setResult(null);
    setError(null);
    setFrozen(exercise);
    stopping.current = false;
    const prep = exercise.details.prep_seconds ?? 0;
    if (prep > 0) setPrepLeft(prep);
    else void beginSpeaking();
  }

  async function stopAndAssess() {
    if (stopping.current) return;
    stopping.current = true;
    const out = await rec.stop();
    const ex = frozen;
    if (!out || !ex) return;
    if (!out.hasSpeech || out.durationMs < 1500) {
      setError("We didn't detect enough speech to assess. Try again and speak for longer.");
      setFrozen(null);
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("audio", out.wav, "answer.wav");
    fd.append("exercise_id", ex.id);
    fd.append("session_id", rec.sessionId);
    fd.append("started_at_ms", String(out.startedAtMs));
    try {
      const r = await api<{ attempt: Attempt }>("/assessments/speaking", { method: "POST", body: fd, timeoutMs: 180_000 });
      setResult(r.attempt);
      requestAnimationFrame(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" }));
    } catch (e) {
      setError(errorMessage(e));
      toast.error("Assessment failed. Please try again.");
    } finally {
      setSubmitting(false);
      setFrozen(null);
    }
  }

  const prepTotal = shown?.details.prep_seconds ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Speaking practice (IELTS-style)"
        description="Answer exam-style questions and get measured fluency and pronunciation data plus AI feedback on grammar, vocabulary and coherence."
      />
      <Alert>
        <Info />
        <AlertDescription>This is self-study practice inspired by the IELTS speaking test. Results are informal estimates, not official IELTS band scores.</AlertDescription>
      </Alert>
      <Tabs
        value={String(part)}
        onValueChange={(v) => {
          if (busy) return;
          setPart(Number(v));
          setExercise(null);
        }}
      >
        <TabsList>
          {[1, 2, 3].map((p) => (
            <TabsTrigger key={p} value={String(p)} disabled={busy}>
              Part {p}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Question</CardTitle>
            <CardDescription>{PART_INFO[part]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-2xl font-medium leading-snug">{shown?.content ?? "Loading question…"}</p>
            {shown?.details.bullet_points && shown.details.bullet_points.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">You should say:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {shown.details.bullet_points.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            {shown?.details.tip && <p className="text-sm text-muted-foreground">Tip: {shown.details.tip}</p>}
            {prepLeft !== null ? (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-4" aria-live="polite">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium">
                    <Hourglass className="size-4" aria-hidden /> Preparation time
                  </span>
                  <span className="font-mono text-lg tabular-nums">{formatMs(prepLeft * 1000)}</span>
                </div>
                <Progress value={((prepTotal - prepLeft) / prepTotal) * 100} aria-label="Preparation progress" />
                <p className="text-sm text-muted-foreground">Make brief notes. Recording starts automatically when the timer ends.</p>
                <Button variant="outline" onClick={() => setPrepLeft(0)}>
                  <SkipForward /> Start speaking now
                </Button>
              </div>
            ) : (
              <RecorderPanel rec={rec} onStart={start} onStop={stopAndAssess} submitting={submitting} disabled={!exercise} startLabel={prepTotal ? "Start (preparation first)" : "Start answering"} maxMs={speakMs} />
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <PrivacyNote />
          </CardContent>
        </Card>
        <ExercisePicker key={part} type="speaking" selected={exercise} onSelect={setExercise} locked={busy} initialId={params.get("exercise")} speakingPart={part} />
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
