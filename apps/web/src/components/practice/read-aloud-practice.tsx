"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { Lightbulb, Target } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSpeechRecorder } from "@/hooks/use-speech-recorder";
import { api, errorMessage } from "@/lib/api";
import type { Attempt, Exercise } from "@/lib/types";
import { AttemptResult } from "./attempt-result";
import { ExercisePicker } from "./exercise-picker";
import { InlineScore } from "./inline-score";
import { PrivacyNote } from "./privacy-note";
import { RecorderPanel } from "./recorder-panel";
import { fmt } from "./stat";
import { TtsPlayer } from "./tts-player";

export function ReadAloudPractice({ type }: { type: "reading" | "tongue_twister" }) {
  const params = useSearchParams();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [frozen, setFrozen] = useState<Exercise | null>(null); // reference locked for the current attempt
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Attempt[]>([]);
  const stopping = useRef(false);
  const isTwister = type === "tongue_twister";
  const rec = useSpeechRecorder({ live: true, maxDurationMs: isTwister ? 60_000 : 180_000, onAutoStop: () => void stopAndAssess() });
  const busy = rec.state === "recording" || rec.state === "requesting" || submitting;
  const shown = frozen || exercise;

  async function start() {
    if (!exercise) return;
    setResult(null);
    setError(null);
    setFrozen(exercise); // freeze reference text
    stopping.current = false;
    const ok = await rec.start();
    if (!ok) setFrozen(null);
  }

  async function stopAndAssess() {
    if (stopping.current || !frozen) return;
    stopping.current = true;
    const out = await rec.stop();
    if (!out) return;
    if (!out.hasSpeech) {
      setError("No speech was detected. Check your microphone and speak clearly, then try again.");
      setFrozen(null);
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("audio", out.wav, "recording.wav");
    fd.append("exercise_id", frozen.id);
    fd.append("content_hash", frozen.content_hash);
    fd.append("session_id", rec.sessionId);
    fd.append("started_at_ms", String(out.startedAtMs));
    try {
      const r = await api<{ attempt: Attempt }>("/assessments/reading", { method: "POST", body: fd, timeoutMs: 180_000 });
      setResult(r.attempt);
      setSession((s) => [r.attempt, ...s]);
      // The score now appears in place on the exercise card, so the page no longer jumps away.
    } catch (e) {
      setError(errorMessage(e));
      toast.error("Assessment failed — your recording was not saved. Please try again.");
    } finally {
      setSubmitting(false);
      setFrozen(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isTwister ? "Tongue twisters" : "Reading aloud"}
        description={
          isTwister
            ? "Listen, then say the tongue twister clearly. Accuracy comes first — pace is only rated once your words are clear."
            : "Read the passage aloud. Your speech is transcribed and compared word by word with the original."
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{shown?.title || "Loading exercise…"}</CardTitle>
                {shown && (
                  <Badge variant="outline" className="capitalize">
                    {shown.difficulty}
                  </Badge>
                )}
              </div>
              {shown?.details.topic && <CardDescription>Topic: {shown.details.topic}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-5">
              {result && !busy && result.exercise_id === shown?.id ? (
                <InlineScore attempt={result} />
              ) : (
                <p className={isTwister ? "text-2xl font-medium leading-relaxed sm:text-3xl" : "text-xl leading-relaxed sm:text-2xl"} lang="en">
                  {shown?.content}
                </p>
              )}
              {isTwister && shown?.details.target_sounds && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Target className="size-4 text-primary" aria-hidden />
                  <span className="text-muted-foreground">Target sounds:</span>
                  {shown.details.target_sounds.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
              {shown?.details.tip && (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden /> {shown.details.tip}
                </p>
              )}
              {shown?.details.key_vocabulary && shown.details.key_vocabulary.length > 0 && (
                <p className="text-sm text-muted-foreground">Key vocabulary: {shown.details.key_vocabulary.join(", ")}</p>
              )}
              {shown && <TtsPlayer text={shown.content} label={isTwister ? "Hear it" : "Listen to the passage"} />}
              <RecorderPanel rec={rec} onStart={start} onStop={stopAndAssess} submitting={submitting} disabled={!exercise} startLabel={isTwister ? "Start recording" : "Start reading"} />
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <PrivacyNote />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <ExercisePicker type={type} selected={exercise} onSelect={setExercise} locked={busy} initialId={params.get("exercise")} />
          {session.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>This session</CardTitle>
                <CardDescription>Unlimited attempts — compare your tries.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Accuracy</TableHead>
                      <TableHead>Pron.</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {session.map((a, i) => (
                      <TableRow key={a.id} className="cursor-pointer" onClick={() => setResult(a)}>
                        <TableCell>{session.length - i}</TableCell>
                        <TableCell className="tabular-nums">{fmt(a.word_accuracy)}%</TableCell>
                        <TableCell className="tabular-nums">{fmt(a.pronunciation_score) ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{fmt(a.metrics.reading_time_s)}s</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {result && (
        <section id="result" aria-label="Results" className="scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Your results</h2>
          <AttemptResult attempt={result} onRetry={() => { setResult(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} onUpdate={setResult} />
        </section>
      )}
    </div>
  );
}
