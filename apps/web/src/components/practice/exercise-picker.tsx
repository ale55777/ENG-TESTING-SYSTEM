"use client";

import { useCallback, useEffect, useState } from "react";
import { Flag, Loader2, RefreshCw, Shuffle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Exercise, ExerciseType, Level } from "@/lib/types";
import { cn } from "@/lib/utils";

type GenType = "reading" | "tongue_twister" | "speaking" | "typing";

export function ExercisePicker({
  type,
  selected,
  onSelect,
  locked,
  initialId,
  allowGenerate = true,
  speakingPart,
}: {
  type: ExerciseType;
  selected: Exercise | null;
  onSelect: (e: Exercise) => void;
  locked?: boolean;
  initialId?: string | null;
  allowGenerate?: boolean;
  speakingPart?: number;
}) {
  const { user } = useAuth();
  const [difficulty, setDifficulty] = useState<Level>(user?.preferred_difficulty || "beginner");
  const [items, setItems] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState({ topic: "", length: "short", vocabulary: "moderate", mode: "standard", focus_sound: "" });
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      const r = await api<{ items: Exercise[] }>(`/exercises?type=${type}&difficulty=${difficulty}`);
      let list = r.items;
      if (type === "speaking" && speakingPart) list = list.filter((e) => (e.details.part ?? 1) === speakingPart);
      setItems(list);
      return list;
    } catch (e) {
      setError(errorMessage(e));
      setItems([]);
      return [];
    }
  }, [type, difficulty, speakingPart]);

  // Initial selection: ?exercise=<id> if given, otherwise first predefined.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (initialId) {
        try {
          const r = await api<{ exercise: Exercise }>(`/exercises/${initialId}`);
          if (alive) {
            setDifficulty(r.exercise.difficulty);
            onSelect(r.exercise);
          }
          return;
        } catch {
          toast.error("That exercise is no longer available; showing others.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load().then((list) => {
      if (!selected && !initialId && list.length) onSelect(list.find((e) => e.source === "predefined") || list[0]);
    });
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setGenerating(true);
    setGenError(null);
    try {
      const r = await api<{ exercise: Exercise }>("/exercises/generate", {
        method: "POST",
        body: { exercise_type: type as GenType, difficulty, ...gen, part: speakingPart ?? 1 },
        timeoutMs: 90_000,
      });
      onSelect(r.exercise);
      setItems((prev) => [r.exercise, ...(prev || [])]);
      toast.success("New exercise generated");
    } catch (e) {
      setGenError(errorMessage(e));
    } finally {
      setGenerating(false);
    }
  }

  function shuffle() {
    const pool = (items || []).filter((e) => e.id !== selected?.id);
    if (pool.length) onSelect(pool[Math.floor(Math.random() * pool.length)]);
  }

  async function report(e: Exercise) {
    try {
      await api(`/exercises/${e.id}/report?reason=${encodeURIComponent("Inappropriate or low quality")}`, { method: "POST" });
      toast.success("Thanks — an administrator will review this exercise.");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const canGenerate = allowGenerate && type !== "pronunciation";

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Choose an exercise</CardTitle>
        <CardDescription>
          {locked ? "The exercise is locked while you practise so the reference text cannot change during scoring." : "Pick a predefined exercise or generate a new one."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={locked} className="min-w-0 space-y-4 disabled:opacity-60">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`diff-${type}`}>Difficulty</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Level)} disabled={locked}>
                <SelectTrigger id={`diff-${type}`} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">{type === "tongue_twister" ? "Easy" : "Beginner"}</SelectItem>
                  <SelectItem value="intermediate">{type === "tongue_twister" ? "Medium" : "Intermediate"}</SelectItem>
                  <SelectItem value="advanced">{type === "tongue_twister" ? "Hard" : "Advanced"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={shuffle} disabled={locked || !items?.length}>
              <Shuffle /> Random
            </Button>
            <Button variant="ghost" size="icon" onClick={load} aria-label="Reload exercises" disabled={locked}>
              <RefreshCw />
            </Button>
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {items === null ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exercises at this level yet{canGenerate ? " — generate one below." : "."}</p>
          ) : (
            <ul className="grid max-h-64 min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto pr-1" aria-label="Available exercises">
              {items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(e)}
                    aria-pressed={selected?.id === e.id}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                      selected?.id === e.id && "border-primary bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{e.title}</span>
                      <span className="block truncate text-muted-foreground">{e.content}</span>
                    </span>
                    {e.source === "ai" && (
                      <Badge variant="secondary" className="shrink-0">
                        <Sparkles className="size-3" /> AI
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canGenerate && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer select-none text-sm font-medium">
                <Sparkles className="mr-1 inline size-4 text-primary" aria-hidden /> Generate a new exercise with AI
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(type === "reading" || type === "typing" || type === "speaking") && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`topic-${type}`}>Topic (optional)</Label>
                    <Input id={`topic-${type}`} maxLength={80} placeholder="e.g. travel, cooking, technology" value={gen.topic} onChange={(e) => setGen({ ...gen, topic: e.target.value })} />
                  </div>
                )}
                {(type === "reading" || type === "typing") && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Length</Label>
                      <Select value={gen.length} onValueChange={(v) => setGen({ ...gen, length: v })}>
                        <SelectTrigger className="w-full" aria-label="Paragraph length">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="short">Short (2–3 sentences)</SelectItem>
                          <SelectItem value="medium">Medium (4–5 sentences)</SelectItem>
                          <SelectItem value="long">Long (6–8 sentences)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Vocabulary</Label>
                      <Select value={gen.vocabulary} onValueChange={(v) => setGen({ ...gen, vocabulary: v })}>
                        <SelectTrigger className="w-full" aria-label="Vocabulary complexity">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simple">Simple</SelectItem>
                          <SelectItem value="moderate">Moderate</SelectItem>
                          <SelectItem value="rich">Rich</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Style</Label>
                      <Select value={gen.mode} onValueChange={(v) => setGen({ ...gen, mode: v })}>
                        <SelectTrigger className="w-full" aria-label="Reading mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Informative</SelectItem>
                          <SelectItem value="story">Short story</SelectItem>
                          <SelectItem value="news">News style</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                {type === "tongue_twister" && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="focus-sound">Target sound (optional)</Label>
                    <Input id="focus-sound" maxLength={20} placeholder="e.g. th, r/l, s/sh" value={gen.focus_sound} onChange={(e) => setGen({ ...gen, focus_sound: e.target.value })} />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Button onClick={generate} disabled={generating || locked}>
                    {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    {generating ? "Generating…" : "Generate"}
                  </Button>
                  {genError && (
                    <p className="mt-2 text-sm text-destructive" role="alert">
                      {genError}
                    </p>
                  )}
                </div>
              </div>
            </details>
          )}
          {selected?.source === "ai" && !locked && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => report(selected)}>
              <Flag /> Report this AI exercise
            </Button>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
