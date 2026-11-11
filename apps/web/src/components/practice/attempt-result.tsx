"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Download, FileJson, FileText, Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { downloadFile, errorMessage } from "@/lib/api";
import type { Attempt, PronWord, SpeakingLanguage } from "@/lib/types";
import { TYPE_LABEL, TYPE_PATH } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FeedbackPanel } from "./feedback-panel";
import { fmt, Stat } from "./stat";
import { SayWord } from "./tts-player";
import { AlignmentLegend, WordAlignmentView } from "./word-alignment";

export function ExportButtons({ attempt }: { attempt: Attempt }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function dl(format: "pdf" | "json" | "txt") {
    setBusy(format);
    try {
      await downloadFile(`/reports/attempts/${attempt.id}?format=${format}`, `report.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => dl("pdf")} disabled={!!busy}>
        <Download /> PDF
      </Button>
      <Button variant="outline" size="sm" onClick={() => dl("json")} disabled={!!busy}>
        <FileJson /> JSON
      </Button>
      <Button variant="outline" size="sm" onClick={() => dl("txt")} disabled={!!busy}>
        <FileText /> TXT
      </Button>
    </div>
  );
}

const PRON_STYLE: Record<PronWord["label"], string> = {
  good: "border-word-correct/40 bg-word-correct-bg text-word-correct",
  unclear: "border-word-missing/40 bg-word-missing-bg text-word-missing",
  likely_mispronounced: "border-word-sub/40 bg-word-sub-bg text-word-sub",
  not_scored: "border-border bg-muted text-muted-foreground",
};
const PRON_LABEL: Record<PronWord["label"], string> = {
  good: "clear",
  unclear: "unclear",
  likely_mispronounced: "possibly mispronounced",
  not_scored: "not scored",
};

export function PronunciationCard({ p }: { p: NonNullable<Attempt["pronunciation"]> }) {
  if (!p.available) {
    return (
      <Alert>
        <Info />
        <AlertTitle>Pronunciation assessment unavailable</AlertTitle>
        <AlertDescription>{p.unavailable_reason || "The acoustic model could not score this recording."} Word-matching accuracy is shown separately and is not a pronunciation score.</AlertDescription>
      </Alert>
    );
  }
  const weak = p.words.filter((w) => w.score !== null && w.score < 75);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pronunciation (acoustic word confidence)</CardTitle>
        <CardDescription>
          Measured from your audio with {p.model}: {p.method}. A low score means the model found weak acoustic evidence for that word — it may be
          mispronounced, unclear or skipped. Accents can lower scores even when you are understandable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5" aria-label="Per-word pronunciation confidence">
          {p.words.map((w) => (
            <span
              key={w.index}
              className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm", PRON_STYLE[w.label])}
              title={w.heard && w.label !== "good" ? `model heard: "${w.heard}"` : undefined}
            >
              {w.word}
              <span className="font-mono text-xs tabular-nums opacity-80">{w.score ?? "–"}</span>
              <span className="sr-only">({PRON_LABEL[w.label]})</span>
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Green ≥ 75 clear · Orange 50–74 unclear · Red &lt; 50 possibly mispronounced (0–100 acoustic confidence).</p>
        {weak.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">Words to practise</h4>
            <ul className="divide-y rounded-lg border">
              {weak.map((w) => (
                <li key={w.index} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{w.word}</span>
                    {w.heard && <span className="text-muted-foreground"> — model heard “{w.heard}”</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums">{w.score}</span>
                    <SayWord word={w.word} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadingResult({ a }: { a: Attempt }) {
  const al = a.alignment;
  const m = a.metrics;
  const twister = a.exercise_type === "tongue_twister";
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Word-matching accuracy"
          value={fmt(a.word_accuracy)}
          unit="%"
          emphasis
          hint="max(0, 1 − WER) × 100, where WER = (substitutions + missing + extra) ÷ reference words. Based on speech recognition, which can make mistakes."
        />
        <Stat
          label="Pronunciation"
          value={a.pronunciation?.available ? fmt(a.pronunciation.overall_score) : "—"}
          unit="/100"
          hint="Acoustic word confidence from your audio (separate from word matching)."
        />
        <Stat label={twister ? "Completion time" : "Reading time"} value={fmt(m.reading_time_s)} unit="s" hint="From first to last detected speech in your recording." />
        {twister ? (
          <Stat
            label="Clear words / min"
            value={m.pace_rated ? fmt(m.clear_words_per_minute, 0) : "—"}
            hint="Only correctly matched words count, and pace is only rated when accuracy is at least 80% — clarity first, speed second."
          />
        ) : (
          <Stat label="Speaking pace" value={fmt(m.wpm, 0)} unit="wpm" hint="Recognized words per minute of speaking time." />
        )}
      </div>
      {al && (
        <Card>
          <CardHeader>
            <CardTitle>Word-by-word comparison</CardTitle>
            <CardDescription>
              {al.correct} matched · {al.substitutions} substituted · {al.deletions} missing · {al.insertions} extra
              {al.repetitions ? ` (${al.repetitions} repeated)` : ""} — out of {al.reference_word_count} reference words
              {al.wer !== null && ` · WER ${al.wer}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AlignmentLegend />
            <WordAlignmentView ops={al.ops} />
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-medium text-muted-foreground">Original text</h4>
                <p className="leading-relaxed">{a.reference_text}</p>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium text-muted-foreground">Recognized speech</h4>
                <p className="leading-relaxed">{a.transcript?.text || <span className="italic text-muted-foreground">No speech was recognized.</span>}</p>
                {a.transcript && <p className="mt-1 text-xs text-muted-foreground">Transcribed by {a.transcript.model}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {m.empty_transcript && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>No speech recognized</AlertTitle>
          <AlertDescription>Check that the right microphone is selected and speak a little louder, then try again.</AlertDescription>
        </Alert>
      )}
      {a.pronunciation && <PronunciationCard p={a.pronunciation} />}
    </>
  );
}

function PronunciationResult({ a }: { a: Attempt }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Pronunciation" value={a.pronunciation?.available ? fmt(a.pronunciation.overall_score) : "—"} unit="/100" emphasis hint="Acoustic word confidence measured from your audio." />
        <Stat label="Word matching (separate metric)" value={fmt(a.word_accuracy)} unit="%" hint="How many words speech recognition matched. This is NOT a pronunciation score." />
        <Stat label="Recording length" value={fmt(a.metrics.duration_s)} unit="s" />
      </div>
      {a.pronunciation && <PronunciationCard p={a.pronunciation} />}
      {a.alignment && (
        <Card>
          <CardHeader>
            <CardTitle>What speech recognition heard</CardTitle>
            <CardDescription>{a.transcript?.text || "No speech recognized."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <AlignmentLegend />
            <WordAlignmentView ops={a.alignment.ops} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

const DIMENSIONS: { key: string; label: string; basis: string }[] = [
  { key: "fluency", label: "Fluency", basis: "Audio: speech rate and long pauses (heuristic)." },
  { key: "pronunciation", label: "Pronunciation", basis: "Audio: acoustic clarity of recognized words." },
  { key: "grammar", label: "Grammar", basis: "Transcript: AI analysis." },
  { key: "vocabulary", label: "Vocabulary", basis: "Transcript: AI analysis." },
  { key: "coherence", label: "Coherence", basis: "Transcript: AI analysis." },
];

function SpeakingResult({ a }: { a: Attempt }) {
  const sp = a.speaking!;
  const f = sp.fluency;
  const lang: SpeakingLanguage | null = a.feedback?.language ?? (sp.language && "grammar" in sp.language ? (sp.language as SpeakingLanguage) : null);
  return (
    <>
      <Alert>
        <Info />
        <AlertTitle>Practice estimates, not an official IELTS score</AlertTitle>
        <AlertDescription>
          Each dimension is an informal 0–9 practice estimate. Fluency and pronunciation come from measurements of your audio; grammar, vocabulary and
          coherence come from an AI reading of the automatic transcript, which can contain recognition errors.
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Overall estimate" value={fmt(sp.estimates.overall)} unit="/9" emphasis />
        {DIMENSIONS.map((d) => (
          <Stat key={d.key} label={d.label} value={fmt(sp.estimates[d.key])} unit="/9" hint={d.basis} />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Measured speech</CardTitle>
          <CardDescription>{f.notes}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            {[
              ["Speaking time", `${fmt(f.speaking_window_s)} s`],
              ["Words", f.word_count],
              ["Speech rate", `${fmt(f.speech_rate_wpm, 0)} wpm`],
              ["Pauses ≥ 0.4 s", f.pause_count],
              ["Long pauses ≥ 1.5 s", f.long_pause_count],
              ["Mean pause", `${fmt(f.mean_pause_s, 2)} s`],
              ["Phonation ratio", fmt(f.phonation_ratio, 2)],
              ["Fillers detected", f.filler_count],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium tabular-nums">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {sp.pronunciation.low_confidence_words?.length > 0 && (
            <p className="mt-4 text-sm">
              <span className="text-muted-foreground">Low acoustic-confidence words: </span>
              {sp.pronunciation.low_confidence_words.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your answer (transcript)</CardTitle>
          <CardDescription>{sp.question}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed">{a.transcript?.text || <span className="italic text-muted-foreground">No speech recognized.</span>}</p>
        </CardContent>
      </Card>
      {lang && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Grammar</CardTitle>
              <CardDescription>{lang.grammar.summary}</CardDescription>
            </CardHeader>
            <CardContent>
              {lang.grammar.issues.length === 0 ? (
                <p className="text-sm text-muted-foreground">No specific issues highlighted.</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {lang.grammar.issues.map((g, i) => (
                    <li key={i}>
                      <span className="rounded bg-word-sub-bg px-1 text-word-sub line-through">{g.original}</span> →{" "}
                      <span className="rounded bg-word-correct-bg px-1 text-word-correct">{g.correction}</span>
                      <p className="mt-0.5 text-muted-foreground">{g.explanation}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Vocabulary &amp; coherence</CardTitle>
              <CardDescription>{lang.vocabulary.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {lang.vocabulary.suggestions.map((v, i) => (
                <div key={i}>
                  <span className="font-medium">“{v.used}”</span> → {v.better_alternatives.join(", ")}
                  <p className="text-muted-foreground">{v.why}</p>
                </div>
              ))}
              <p>
                <span className="font-medium">Coherence: </span>
                {lang.coherence.summary} {lang.coherence.relevance_to_question}
              </p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>A stronger version of your answer</CardTitle>
              <CardDescription>Your ideas, expressed at roughly one level higher. Use it as a model, not a script.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">{lang.improved_answer}</p>
              {lang.next_steps.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {lang.next_steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function TypingResult({ a }: { a: Attempt }) {
  const t = a.typing!;
  const ref = a.reference_text;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net WPM" value={fmt(t.net_wpm)} emphasis hint="Gross WPM − uncorrected errors per minute." />
        <Stat label="Gross WPM" value={fmt(t.gross_wpm)} hint="(characters typed ÷ 5) ÷ minutes." />
        <Stat label="Accuracy" value={fmt(t.accuracy)} unit="%" hint="Correct characters ÷ characters typed (final text)." />
        <Stat label="Time" value={fmt(t.elapsed_ms / 1000)} unit="s" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>{t.mode === "challenge" ? "Challenge mode — no corrections possible." : "Practice mode — corrections allowed."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableBody>
              {[
                ["Correct characters", t.correct_chars],
                ["Incorrect characters (uncorrected)", t.uncorrected_errors],
                ["Corrected errors", t.corrected_errors],
                ["Total keystrokes", t.total_keystrokes],
                ["Error rate", `${fmt(t.error_rate)}%`],
                ["Completed passage", t.completed ? "Yes" : `No (${t.typed_chars} of ${ref.length} characters)`],
              ].map(([k, v]) => (
                <TableRow key={String(k)}>
                  <TableCell className="text-muted-foreground">{k}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{v}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">Your text (errors highlighted)</h4>
            <p className="break-words font-mono text-sm leading-relaxed">
              {t.typed_text.split("").map((ch, i) =>
                ch === ref[i] ? (
                  <span key={i}>{ch}</span>
                ) : (
                  <span key={i} className="rounded-sm bg-word-sub-bg text-word-sub underline" title={`expected "${ref[i]}"`}>
                    {ch === " " ? "␣" : ch}
                  </span>
                ),
              )}
            </p>
          </div>
        </CardContent>
      </Card>
      {a.feedback?.tips && a.feedback.tips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tips</CardTitle>
            <CardDescription>Rule-based, from your measured numbers.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5">
              {a.feedback.tips.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function AttemptResult({ attempt, onUpdate, onRetry }: { attempt: Attempt; onUpdate?: (a: Attempt) => void; onRetry?: () => void }) {
  const a = attempt;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{TYPE_LABEL[a.exercise_type]}</Badge>
          {a.difficulty && <Badge variant="outline" className="capitalize">{a.difficulty}</Badge>}
          <span className="text-sm text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRetry ? (
            <Button size="sm" onClick={onRetry}>
              <RotateCcw /> Try again
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href={a.exercise_id ? `${TYPE_PATH[a.exercise_type]}?exercise=${a.exercise_id}` : TYPE_PATH[a.exercise_type]}>
                <RotateCcw /> Repeat exercise
              </Link>
            </Button>
          )}
          <ExportButtons attempt={a} />
        </div>
      </div>
      {a.exercise_type === "typing" && a.typing && <TypingResult a={a} />}
      {a.exercise_type === "speaking" && a.speaking && <SpeakingResult a={a} />}
      {a.exercise_type === "pronunciation" && <PronunciationResult a={a} />}
      {(a.exercise_type === "reading" || a.exercise_type === "tongue_twister") && <ReadingResult a={a} />}
      {a.exercise_type !== "typing" && <FeedbackPanel attempt={a} onUpdate={onUpdate} />}
      <p className="text-xs text-muted-foreground">{a.disclaimer}</p>
    </div>
  );
}
