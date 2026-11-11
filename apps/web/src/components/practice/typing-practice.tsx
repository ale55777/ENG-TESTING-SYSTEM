"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TypingMode } from "@/lib/typing/engine";
import type { Attempt, Exercise } from "@/lib/types";
import { AttemptResult } from "./attempt-result";
import { ExercisePicker } from "./exercise-picker";
import { TypingTest } from "./typing-test";

export function TypingPractice() {
  const params = useSearchParams();
  const [mode, setMode] = useState<TypingMode>(params.get("mode") === "challenge" ? "challenge" : "practice");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [result, setResult] = useState<Attempt | null>(null);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Typing practice"
        description="Measure your speed and accuracy. WPM = (characters typed ÷ 5) ÷ minutes; net WPM subtracts uncorrected errors per minute."
      />
      <Tabs value={mode} onValueChange={(v) => !running && (setMode(v as TypingMode), setResult(null))}>
        <TabsList>
          <TabsTrigger value="practice" disabled={running}>
            Practice mode
          </TabsTrigger>
          <TabsTrigger value="challenge" disabled={running}>
            Challenge mode
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          {result ? (
            <AttemptResult
              attempt={result}
              onRetry={() => {
                setResult(null);
                setRound((r) => r + 1);
              }}
            />
          ) : exercise ? (
            <TypingTest key={`${exercise.id}-${mode}-${round}`} exercise={exercise} mode={mode} onDone={setResult} onRunningChange={setRunning} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">Loading exercise…</CardContent>
            </Card>
          )}
        </div>
        <ExercisePicker
          type="typing"
          selected={exercise}
          onSelect={(e) => {
            setExercise(e);
            setResult(null);
          }}
          locked={running}
          initialId={params.get("exercise")}
        />
      </div>
    </div>
  );
}
