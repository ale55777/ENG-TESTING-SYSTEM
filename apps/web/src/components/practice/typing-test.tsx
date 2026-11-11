"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, Keyboard, Loader2, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api";
import { acceptInput, allowedInputType, liveStats, type TypingMode } from "@/lib/typing/engine";
import type { Attempt, Exercise } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatMs } from "./recorder-panel";

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function TypingTest({ exercise, mode, onDone, onRunningChange }: { exercise: Exercise; mode: TypingMode; onDone: (a: Attempt) => void; onRunningChange?: (r: boolean) => void }) {
  const reference = exercise.content;
  const [typed, setTyped] = useState("");
  const [startAt, setStartAt] = useState<number | null>(null); // performance.now() (monotonic)
  const [now, setNow] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [blockedFlash, setBlockedFlash] = useState(false);
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typedRef = useRef("");
  const composing = useRef(false);
  const counters = useRef({ keystrokes: 0, corrected: 0 });
  const startedWall = useRef<number>(0);
  const finished = useRef(false);

  const reset = useCallback(() => {
    typedRef.current = "";
    setTyped("");
    setStartAt(null);
    counters.current = { keystrokes: 0, corrected: 0 };
    finished.current = false;
    if (taRef.current) taRef.current.value = "";
    onRunningChange?.(false);
  }, [onRunningChange]);

  useEffect(() => reset(), [exercise.id, mode, reset]);

  useEffect(() => {
    if (startAt === null || finished.current) return;
    const t = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(t);
  }, [startAt]);

  const flash = () => {
    setBlockedFlash(true);
    setTimeout(() => setBlockedFlash(false), 250);
  };

  const keepCaretAtEnd = () => {
    const ta = taRef.current;
    if (!ta) return;
    const end = ta.value.length;
    if (ta.selectionStart !== end || ta.selectionEnd !== end) ta.setSelectionRange(end, end);
  };

  const submit = useCallback(
    async (finalText: string, elapsedMs: number) => {
      if (finished.current) return;
      finished.current = true;
      setSubmitting(true);
      try {
        const r = await api<{ attempt: Attempt }>("/assessments/typing", {
          method: "POST",
          body: {
            exercise_id: exercise.id,
            content_hash: exercise.content_hash,
            mode,
            typed_text: finalText,
            elapsed_ms: Math.max(1, Math.round(elapsedMs)),
            total_keystrokes: counters.current.keystrokes,
            corrected_errors: mode === "challenge" ? 0 : counters.current.corrected,
            started_at_ms: startedWall.current,
          },
        });
        onRunningChange?.(false);
        onDone(r.attempt);
      } catch (e) {
        finished.current = false;
        toast.error(errorMessage(e));
      } finally {
        setSubmitting(false);
      }
    },
    [exercise.id, exercise.content_hash, mode, onDone, onRunningChange],
  );

  /** Validate the textarea's current DOM value against the accepted text. */
  const reconcile = useCallback(() => {
    const ta = taRef.current;
    if (!ta || finished.current) return;
    const prev = typedRef.current;
    const res = acceptInput(prev, ta.value, reference, mode);
    if (res.rejected) flash();
    if (ta.value !== res.text) ta.value = res.text;
    keepCaretAtEnd();
    if (res.text === prev) return;
    let t0 = startAt;
    if (t0 === null && res.inserted > 0) {
      t0 = performance.now();
      startedWall.current = Date.now();
      setStartAt(t0);
      onRunningChange?.(true);
    }
    counters.current.keystrokes += res.inserted + res.deleted;
    counters.current.corrected += res.correctedErrors;
    typedRef.current = res.text;
    setTyped(res.text);
    setNow(performance.now());
    if (res.text.length === reference.length && t0 !== null) void submit(res.text, performance.now() - t0);
  }, [mode, reference, startAt, submit, onRunningChange]);

  // Native beforeinput gives us inputType (React's synthetic onBeforeInput does not).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const onBefore = (e: InputEvent) => {
      if (finished.current) {
        e.preventDefault();
        return;
      }
      if (!allowedInputType(e.inputType, mode)) {
        e.preventDefault();
        flash();
        return;
      }
      if ((e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") && reference[typedRef.current.length] !== "\n") {
        e.preventDefault();
      }
    };
    ta.addEventListener("beforeinput", onBefore);
    return () => ta.removeEventListener("beforeinput", onBefore);
  }, [mode, reference]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (NAV_KEYS.has(k)) {
      e.preventDefault(); // cursor can never move backward (or anywhere)
      return;
    }
    if (mod && k.length === 1) {
      // Block undo/redo, select-all, cut/paste/copy and other editing shortcuts.
      e.preventDefault();
      if (mode === "challenge") flash();
      return;
    }
    if (mode === "challenge" && (k === "Backspace" || k === "Delete")) {
      e.preventDefault();
      flash();
      return;
    }
    if (k === "Delete") e.preventDefault();
    if (k === "Enter" && reference[typedRef.current.length] !== "\n") e.preventDefault();
    if (k === "Tab") e.preventDefault();
  }

  const elapsed = startAt === null ? 0 : now - startAt;
  const stats = useMemo(() => liveStats(typed, reference, elapsed), [typed, reference, elapsed]);
  const progress = Math.round((typed.length / reference.length) * 100);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{exercise.title}</CardTitle>
          <Badge variant={mode === "challenge" ? "default" : "secondary"}>
            {mode === "challenge" ? <Lock className="size-3" /> : <Keyboard className="size-3" />}
            {mode === "challenge" ? "Challenge — no corrections" : "Practice — corrections allowed"}
          </Badge>
        </div>
        <CardDescription>
          {mode === "challenge"
            ? "Backspace, deleting, moving the cursor, selecting, pasting, undo and drag-and-drop are disabled. Typing only moves forward."
            : "Type the text below. Errors are highlighted live; Backspace is allowed. Pasting is disabled."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5" aria-live="off">
          {[
            ["Time", formatMs(elapsed)],
            // Speed is meaningless over a fraction of a second; show it once 2 s have elapsed.
            ["Net WPM", elapsed >= 2000 ? stats.netWpm.toFixed(0) : "—"],
            ["Gross WPM", elapsed >= 2000 ? stats.grossWpm.toFixed(0) : "—"],
            ["Accuracy", `${stats.accuracy.toFixed(1)}%`],
            ["Errors", String(stats.errors)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-muted/30 px-2 py-2">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="font-mono text-lg font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div
          className={cn(
            "relative rounded-xl border-2 bg-card p-4 font-mono text-lg leading-loose transition-colors sm:p-6 sm:text-xl",
            focused ? "border-primary" : "border-border",
            blockedFlash && "border-destructive",
          )}
          onClick={() => taRef.current?.focus()}
        >
          <p id="typing-ref" aria-hidden className="select-none whitespace-pre-wrap break-words">
            {reference.split("").map((ch, i) => {
              const t = typed[i];
              const isCursor = i === typed.length;
              return (
                <span
                  key={i}
                  className={cn(
                    t === undefined && "text-muted-foreground",
                    t !== undefined && t === ch && "text-word-correct",
                    t !== undefined && t !== ch && "rounded-sm bg-word-sub-bg text-word-sub underline decoration-2",
                    isCursor && focused && "border-l-2 border-primary animate-pulse",
                  )}
                >
                  {t !== undefined && t !== ch && ch === " " ? "·" : ch}
                </span>
              );
            })}
          </p>
          <textarea
            ref={taRef}
            aria-label={`Type the passage: ${reference}`}
            className="absolute inset-0 h-full w-full resize-none cursor-text opacity-0"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-gramm="false"
            disabled={submitting}
            onKeyDown={onKeyDown}
            onInput={() => {
              if (!composing.current) reconcile();
            }}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => {
              composing.current = false;
              reconcile();
            }}
            onPaste={(e) => {
              e.preventDefault();
              flash();
            }}
            onCut={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              flash();
            }}
            onDragOver={(e) => e.preventDefault()}
            onSelect={keepCaretAtEnd}
            onMouseUp={keepCaretAtEnd}
            onContextMenu={(e) => e.preventDefault()}
            onFocus={() => {
              setFocused(true);
              keepCaretAtEnd();
            }}
            onBlur={() => setFocused(false)}
          />
          {!focused && typed.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center font-sans text-sm text-muted-foreground">Click here and start typing — the timer starts with your first key.</div>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => startAt !== null && submit(typedRef.current, performance.now() - startAt)} disabled={startAt === null || submitting || typed.length === 0}>
            {submitting ? <Loader2 className="animate-spin" /> : <Flag />} Finish now
          </Button>
          <Button variant="outline" onClick={reset} disabled={submitting}>
            <RotateCcw /> Restart
          </Button>
          <span className="self-center text-sm text-muted-foreground">
            {typed.length}/{reference.length} characters
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
