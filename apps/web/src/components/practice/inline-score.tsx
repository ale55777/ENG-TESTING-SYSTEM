"use client";

import { ArrowDown, Check, Minus, Plus, X } from "lucide-react";
import type { Attempt } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmt } from "./stat";
import { WordAlignmentView } from "./word-alignment";

function band(score: number | null | undefined) {
  if (score === null || score === undefined) return { label: "Not scored", cls: "text-muted-foreground", ring: "stroke-muted-foreground/40" };
  if (score >= 90) return { label: "Excellent", cls: "text-word-correct", ring: "stroke-word-correct" };
  if (score >= 75) return { label: "Good", cls: "text-word-correct", ring: "stroke-word-correct" };
  if (score >= 50) return { label: "Keep practising", cls: "text-word-missing", ring: "stroke-word-missing" };
  return { label: "Needs work", cls: "text-word-sub", ring: "stroke-word-sub" };
}

function ScoreRing({ score, unit }: { score: number | null | undefined; unit: string }) {
  const b = band(score);
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className={cn("transition-[stroke-dashoffset] duration-700", b.ring)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-bold tabular-nums", b.cls)}>{score === null || score === undefined ? "—" : fmt(score, 0)}</span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

/**
 * Score shown right on the exercise card, the moment the transcript has been matched to the text:
 * a headline score, matched-word count, and the passage re-drawn with each word colour-coded.
 */
export function InlineScore({ attempt, primary = "accuracy" }: { attempt: Attempt; primary?: "accuracy" | "pronunciation" }) {
  const al = attempt.alignment;
  const pron = attempt.pronunciation?.available ? attempt.pronunciation.overall_score : null;
  const main = primary === "pronunciation" ? pron : attempt.word_accuracy;
  const b = band(main);
  const title = primary === "pronunciation" ? "Pronunciation score" : "Your score";
  const unit = primary === "pronunciation" ? "/ 100" : "%";

  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4" role="status" aria-live="polite" aria-label={`${title}: ${main ?? "not available"}${unit}`}>
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={main} unit={unit} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm text-muted-foreground">{title}</div>
          <div className={cn("text-xl font-semibold", b.cls)}>{b.label}</div>
          {al && (
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{al.correct}</span> of <span className="tabular-nums">{al.reference_word_count}</span> words matched
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {primary === "pronunciation"
              ? `Word matching: ${attempt.word_accuracy === null ? "—" : `${fmt(attempt.word_accuracy, 0)}%`}`
              : `Pronunciation: ${pron === null ? "not available" : `${fmt(pron, 0)} / 100`}`}
          </p>
        </div>
        {al && (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label="Word counts">
            <li className="flex items-center gap-1.5 text-word-correct">
              <Check className="size-4" aria-hidden /> <span className="tabular-nums font-medium">{al.correct}</span> matched
            </li>
            <li className="flex items-center gap-1.5 text-word-sub">
              <X className="size-4" aria-hidden /> <span className="tabular-nums font-medium">{al.substitutions}</span> wrong
            </li>
            <li className="flex items-center gap-1.5 text-word-missing">
              <Minus className="size-4" aria-hidden /> <span className="tabular-nums font-medium">{al.deletions}</span> missing
            </li>
            <li className="flex items-center gap-1.5 text-word-extra">
              <Plus className="size-4" aria-hidden /> <span className="tabular-nums font-medium">{al.insertions}</span> extra
            </li>
          </ul>
        )}
      </div>
      {al && al.ops.length > 0 && <WordAlignmentView ops={al.ops} />}
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
        onClick={() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      >
        <ArrowDown className="size-4" aria-hidden /> Full breakdown and feedback
      </button>
    </div>
  );
}
