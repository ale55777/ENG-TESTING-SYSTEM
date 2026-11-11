"use client";

import { Loader2, Mic, Square, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { useSpeechRecorder } from "@/hooks/use-speech-recorder";
import { cn } from "@/lib/utils";
import { useMicPreference } from "@/lib/audio/mic-preference";
import Link from "next/link";

type Rec = ReturnType<typeof useSpeechRecorder>;

/** "Microphone: X · Change" line, so learners always know which input is being recorded. */
function MicSource({ active }: { active: { label: string } | null }) {
  const pref = useMicPreference();
  const name = active?.label || pref?.label || "System default";
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Mic className="size-3.5" aria-hidden />
      <span>
        Microphone: <span className="font-medium text-foreground">{name}</span>
      </span>
      <span aria-hidden>·</span>
      <Link href="/settings#microphone" className="underline underline-offset-2 hover:text-foreground">
        Change
      </Link>
    </p>
  );
}

export function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function RecorderPanel({
  rec,
  onStart,
  onStop,
  submitting,
  startLabel = "Start reading",
  disabled,
  maxMs,
  showLive = true,
}: {
  rec: Rec;
  onStart: () => void;
  onStop: () => void;
  submitting: boolean;
  startLabel?: string;
  disabled?: boolean;
  maxMs?: number;
  showLive?: boolean;
}) {
  const recording = rec.state === "recording";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <Button size="lg" onClick={onStart} disabled={disabled || submitting || rec.state === "requesting" || rec.state === "stopping"}>
            {rec.state === "requesting" ? <Loader2 className="animate-spin" /> : <Mic />}
            {rec.state === "requesting" ? "Waiting for microphone…" : startLabel}
          </Button>
        ) : (
          <>
            <Button size="lg" variant="destructive" onClick={onStop}>
              <Square /> Stop &amp; assess
            </Button>
            <Button size="lg" variant="ghost" onClick={() => rec.cancel()}>
              <X /> Cancel
            </Button>
          </>
        )}
        {recording && (
          <div className="flex items-center gap-3" aria-live="polite">
            <span className="relative flex size-3" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex size-3 rounded-full bg-red-600" />
            </span>
            <span className="font-mono tabular-nums">
              {formatMs(rec.elapsedMs)}
              {maxMs ? <span className="text-muted-foreground"> / {formatMs(maxMs)}</span> : null}
            </span>
            <span className="text-sm text-muted-foreground">{rec.speaking ? "Speech detected" : rec.speechDetected ? "Listening… (pause)" : "Listening…"}</span>
          </div>
        )}
        {submitting && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Transcribing and scoring…
          </span>
        )}
      </div>
      <MicSource active={recording ? rec.mic : null} />
      {recording && rec.mic?.fellBack && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Your chosen microphone wasn&apos;t available, so the system default is being used.
        </p>
      )}
      {recording && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rec.level * 100)}>
          <div className={cn("h-full rounded-full transition-[width] duration-75", rec.speaking ? "bg-green-500" : "bg-muted-foreground/40")} style={{ width: `${Math.round(rec.level * 100)}%` }} />
        </div>
      )}
      {rec.error && (
        <Alert variant="destructive">
          <AlertDescription>{rec.error}</AlertDescription>
        </Alert>
      )}
      {showLive && (recording || submitting) && (
        <div className="rounded-lg border bg-muted/40 p-3" aria-live="polite">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Live transcript <span className="normal-case">(chunked, updates every few seconds)</span>
          </div>
          <p className={cn("min-h-6", !rec.liveText && "text-muted-foreground")}>
            {rec.liveText || (rec.speechDetected ? "Transcribing…" : "Start speaking — your words will appear here.")}
            {rec.hasPartial && <span className="ml-1 animate-pulse text-muted-foreground">▍</span>}
          </p>
          {rec.liveError && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{rec.liveError}</p>}
        </div>
      )}
    </div>
  );
}
