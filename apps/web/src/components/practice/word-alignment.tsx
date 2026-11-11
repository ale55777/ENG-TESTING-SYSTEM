"use client";

import { Check, Minus, Plus, Repeat, X } from "lucide-react";
import type { AlignmentOp } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLE = {
  correct: { cls: "bg-word-correct-bg text-word-correct", icon: Check, label: "matched" },
  substitution: { cls: "bg-word-sub-bg text-word-sub", icon: X, label: "substituted" },
  deletion: { cls: "bg-word-missing-bg text-word-missing line-through decoration-2", icon: Minus, label: "missing" },
  insertion: { cls: "bg-word-extra-bg text-word-extra italic", icon: Plus, label: "extra" },
} as const;

export function AlignmentLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Colour legend">
      {(["correct", "substitution", "deletion", "insertion"] as const).map((k) => {
        const S = STYLE[k];
        return (
          <li key={k} className="flex items-center gap-1.5">
            <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", S.cls)}>
              <S.icon className="size-3" aria-hidden />
              {k === "correct" ? "Green" : k === "substitution" ? "Red" : k === "deletion" ? "Orange" : "Blue"}
            </span>
            {S.label}
          </li>
        );
      })}
      <li className="flex items-center gap-1.5">
        <Repeat className="size-3" aria-hidden /> repeated word
      </li>
    </ul>
  );
}

/** Word-by-word result. Meaning is carried by colour + icon + screen-reader text, never colour alone. */
export function WordAlignmentView({ ops }: { ops: AlignmentOp[] }) {
  if (!ops.length) return <p className="text-muted-foreground">No words to compare.</p>;
  return (
    <p className="flex flex-wrap gap-x-1 gap-y-1.5 text-lg leading-relaxed" aria-label="Word-by-word comparison">
      {ops.map((o, i) => {
        const S = STYLE[o.type];
        const text = o.type === "insertion" ? o.hyp : o.ref;
        let title: string = S.label;
        if (o.type === "substitution") title = `expected "${o.ref}", heard "${o.hyp}"`;
        if (o.type === "insertion") title = o.repeated ? `extra word "${o.hyp}" (repeated)` : `extra word "${o.hyp}"`;
        if (o.type === "deletion") title = `missing word "${o.ref}"`;
        return (
          <span key={i} title={title} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5", S.cls)}>
            {o.type !== "correct" && <S.icon className="size-3.5 shrink-0" aria-hidden />}
            {o.repeated && <Repeat className="size-3.5 shrink-0" aria-hidden />}
            <span>{text}</span>
            {o.type === "substitution" && <span className="text-sm opacity-80">→ {o.hyp}</span>}
            <span className="sr-only">({title})</span>
          </span>
        );
      })}
    </p>
  );
}
