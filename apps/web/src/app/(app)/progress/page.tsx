"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DailyBarChart, MultiTrendChart, TrendChart } from "@/components/progress/charts";
import { api, errorMessage } from "@/lib/api";

type Pt = Record<string, string | number | null>;

export default function ProgressPage() {
  const [days, setDays] = useState("30");
  const [daily, setDaily] = useState<Pt[] | null>(null);
  const [trends, setTrends] = useState<Record<string, Pt[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDaily(null);
    Promise.all([api<{ points: Pt[] }>(`/progress/timeseries?days=${days}`), api<Record<string, Pt[]>>("/progress/trends?limit=50")])
      .then(([d, t]) => {
        setDaily(d.points);
        setTrends(t);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [days]);

  const empty = trends && Object.values(trends).every((v) => v.length === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Learning progress"
        description="All charts use your saved results only. Each chart has a table view."
        actions={
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40" aria-label="Time range for daily charts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {error && <p className="text-destructive" role="alert">{error}</p>}
      {!trends || !daily ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : empty ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BarChart3 className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">Your progress charts will appear after your first completed exercise.</p>
            <Button asChild>
              <Link href="/practice/reading">Start practising</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <DailyBarChart title="Practice sessions per day" description="Grouped by UTC day" data={daily} dataKey="sessions" colorVar="--chart-1" />
          <DailyBarChart title="Practice minutes per day" description="Grouped by UTC day" data={daily} dataKey="practice_minutes" unit=" min" colorVar="--chart-1" />
          <TrendChart title="Reading word-matching accuracy" description="Per attempt" data={trends.reading} dataKey="accuracy" unit="%" colorVar="--chart-1" domain={[0, 100]} />
          <TrendChart title="Tongue-twister accuracy" description="Per attempt" data={trends.tongue_twister} dataKey="accuracy" unit="%" colorVar="--chart-3" domain={[0, 100]} />
          <TrendChart
            title="Pronunciation score"
            description="Acoustic word confidence, pronunciation drills"
            data={trends.pronunciation}
            dataKey="pronunciation"
            unit="/100"
            colorVar="--chart-2"
            domain={[0, 100]}
          />
          <MultiTrendChart
            title="Speaking estimates (0–9, practice only)"
            description="Audio-measured dimensions"
            data={trends.speaking}
            series={[
              { key: "overall", label: "Overall", colorVar: "--chart-1" },
              { key: "fluency", label: "Fluency", colorVar: "--chart-2" },
              { key: "pronunciation", label: "Pronunciation", colorVar: "--chart-3" },
            ]}
            domain={[0, 9]}
          />
          <MultiTrendChart
            title="Speaking language estimates (0–9)"
            description="Transcript-based AI estimates"
            data={trends.speaking}
            series={[
              { key: "grammar", label: "Grammar", colorVar: "--chart-1" },
              { key: "vocabulary", label: "Vocabulary", colorVar: "--chart-2" },
              { key: "coherence", label: "Coherence", colorVar: "--chart-3" },
            ]}
            domain={[0, 9]}
          />
          <TrendChart title="Typing speed (net WPM)" description="Per attempt" data={trends.typing} dataKey="wpm" unit=" WPM" colorVar="--chart-2" />
          <TrendChart title="Typing accuracy" description="Per attempt — shown separately from speed (different scale)" data={trends.typing} dataKey="accuracy" unit="%" colorVar="--chart-1" domain={[0, 100]} />
        </div>
      )}
    </div>
  );
}
