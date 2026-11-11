"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpenText, Keyboard, MessagesSquare, Mic2, Sparkles, Wind, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, Stat } from "@/components/practice/stat";
import { RecentAttemptsTable } from "@/components/progress/recent-attempts";
import { TrendChart } from "@/components/progress/charts";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AttemptSummary } from "@/lib/types";

interface Summary {
  total_sessions: number;
  total_practice_minutes: number;
  streak_days: number;
  counts: Record<string, number>;
  reading_accuracy_avg: number | null;
  twister_accuracy_avg: number | null;
  pronunciation_score_avg: number | null;
  speaking_estimate_avg: number | null;
  typing_wpm_avg: number | null;
  typing_wpm_best: number | null;
  typing_accuracy_avg: number | null;
  recent: AttemptSummary[];
}
interface Rec {
  id: string;
  kind: string;
  title: string;
  reason: string;
  target: { path: string; custom_text?: string; mode?: string; part?: number; difficulty?: string };
}
type Trends = Record<string, { at: string; accuracy?: number | null; pronunciation?: number | null; wpm?: number | null; overall?: number | null }[]>;

const MODULES = [
  { href: "/practice/reading", label: "Reading aloud", icon: BookOpenText, desc: "Read a passage; get word-by-word accuracy." },
  { href: "/practice/pronunciation", label: "Pronunciation", icon: Mic2, desc: "Word-level acoustic feedback on difficult sounds." },
  { href: "/practice/tongue-twisters", label: "Tongue twisters", icon: Wind, desc: "Clarity first, then speed." },
  { href: "/practice/speaking", label: "Speaking", icon: MessagesSquare, desc: "IELTS-style questions with AI feedback." },
  { href: "/practice/typing", label: "Typing", icon: Keyboard, desc: "Practice or strict no-correction challenge." },
];

function recHref(r: Rec) {
  const q = new URLSearchParams();
  if (r.target.custom_text) q.set("text", r.target.custom_text);
  if (r.target.mode) q.set("mode", r.target.mode);
  if (r.target.part) q.set("part", String(r.target.part));
  const s = q.toString();
  return r.target.path + (s ? `?${s}` : "");
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Summary>("/progress/summary"), api<{ items: Rec[] }>("/recommendations"), api<Trends>("/progress/trends?limit=20")])
      .then(([s, r, t]) => {
        setSummary(s);
        setRecs(r.items);
        setTrends(t);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function dismiss(id: string) {
    setRecs((r) => r?.filter((x) => x.id !== id) ?? null);
    await api(`/recommendations/${id}/dismiss`, { method: "POST" }).catch(() => {});
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const isNew = summary && summary.total_sessions === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${greeting}, ${user?.display_name ?? ""}`}
        description={
          <>
            Current level: <Badge variant="secondary" className="capitalize">{user?.proficiency_level}</Badge>
            {summary && summary.streak_days > 0 && <span className="ml-2">· {summary.streak_days}-day practice streak</span>}
          </>
        }
      />
      {error && <p className="text-destructive" role="alert">{error}</p>}

      {!summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : isNew ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Sparkles className="size-10 text-primary" aria-hidden />
            <div>
              <h2 className="text-xl font-semibold">No practice yet</h2>
              <p className="mt-1 max-w-md text-muted-foreground">Your statistics will appear here after your first exercise. A short reading-aloud exercise is a good place to start.</p>
            </div>
            <Button asChild size="lg">
              <Link href="/practice/reading">
                Start practising <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Practice sessions" value={summary.total_sessions} hint={`${summary.total_practice_minutes} minutes in total`} />
          <Stat label="Avg reading accuracy" value={fmt(summary.reading_accuracy_avg)} unit="%" hint="Average word-matching accuracy across reading attempts." />
          <Stat label="Avg pronunciation" value={fmt(summary.pronunciation_score_avg)} unit="/100" hint="Average acoustic word confidence (reading, twister and pronunciation drills)." />
          <Stat label="Speaking estimate" value={fmt(summary.speaking_estimate_avg)} unit="/9" hint="Average informal practice estimate — not an IELTS band." />
          <Stat label="Typing speed (avg net)" value={fmt(summary.typing_wpm_avg, 0)} unit="WPM" hint={summary.typing_wpm_best ? `Best: ${fmt(summary.typing_wpm_best, 0)} WPM` : undefined} />
          <Stat label="Typing accuracy" value={fmt(summary.typing_accuracy_avg)} unit="%" />
          <Stat label="Tongue-twister accuracy" value={fmt(summary.twister_accuracy_avg)} unit="%" />
          <Stat label="Practice time" value={fmt(summary.total_practice_minutes)} unit="min" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {trends && !isNew && (
            <div className="grid gap-4 md:grid-cols-2">
              <TrendChart title="Reading accuracy" data={trends.reading} dataKey="accuracy" unit="%" colorVar="--chart-1" domain={[0, 100]} />
              <TrendChart title="Typing speed (net WPM)" data={trends.typing} dataKey="wpm" unit=" WPM" colorVar="--chart-2" />
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Practice modules</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {MODULES.map((m) => (
                <Link key={m.href} href={m.href} className="group flex items-start gap-3 rounded-xl border p-4 transition-colors hover:border-primary hover:bg-accent">
                  <m.icon className="mt-0.5 size-5 text-primary" aria-hidden />
                  <span>
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-sm text-muted-foreground">{m.desc}</span>
                  </span>
                  <ArrowRight className="ml-auto size-4 self-center opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </Link>
              ))}
            </CardContent>
          </Card>
          {summary && summary.recent.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent attempts</CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/history">View all</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <RecentAttemptsTable items={summary.recent} />
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Recommended next</CardTitle>
            <CardDescription>Based only on your saved results.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!recs ? (
              <Skeleton className="h-24" />
            ) : recs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recommendations right now.</p>
            ) : (
              recs.map((r) => (
                <div key={r.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={recHref(r)} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <Button variant="ghost" size="icon-xs" onClick={() => dismiss(r.id)} aria-label={`Dismiss: ${r.title}`}>
                      <X />
                    </Button>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
