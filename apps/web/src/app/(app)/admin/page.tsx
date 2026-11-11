"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, EyeOff, Loader2, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Stat } from "@/components/practice/stat";
import { DailyBarChart } from "@/components/progress/charts";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Exercise } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}

function Overview() {
  const { data, error } = useLoad<any>("/admin/overview");
  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Registered users" value={data.users} />
        <Stat label="Active users (7 days)" value={data.active_users_7d} />
        <Stat label="Total attempts" value={data.attempts} />
        <Stat label="Errors (24 h)" value={data.errors_24h} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <DailyBarChart title="Attempts per day (last 14 days, UTC)" data={data.attempts_daily} dataKey="count" colorVar="--chart-1" />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attempts by module</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell>{v}</TableCell>
                    <TableCell className="text-right tabular-nums">{data.attempts_by_type[k] ?? 0}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>AI-generated exercises</TableCell>
                  <TableCell className="text-right tabular-nums">{data.ai_generated_exercises}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Flagged exercises awaiting review</TableCell>
                  <TableCell className="text-right tabular-nums">{data.exercises_by_status.flagged ?? 0}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">Aggregate statistics only. Administrators cannot view learners&apos; transcripts, recordings or feedback.</p>
    </div>
  );
}

function Health() {
  const { data, error, load } = useLoad<any>("/admin/health");
  const row = (label: string, ok: boolean | undefined, detail?: string) => (
    <TableRow key={label}>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell>
        {ok ? (
          <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-4" /> OK
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-destructive">
            <XCircle className="size-4" /> Unavailable
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{detail}</TableCell>
    </TableRow>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI & service health</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw /> Re-check
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive">{error}</p>}
        {!data ? (
          <Skeleton className="h-40" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row("PostgreSQL", data.database.ok, `${data.database.latency_ms} ms`)}
              {row("Groq (GPT-OSS + Whisper)", data.groq.ok, data.groq.ok ? `${data.groq.latency_ms} ms · chat model ${data.groq.chat_model_available ? "available" : "missing"} · STT ${data.groq.stt_model_available ? "available" : "missing"}` : data.groq.detail)}
              {row("Ably realtime", data.ably.ok, data.ably.ok ? `${data.ably.latency_ms} ms · published ${data.ably.published}, failed ${data.ably.failed}` : data.ably.detail)}
              {row("Supertonic TTS (local)", data.tts.available, data.tts.error || `${data.tts.model}, ${data.tts.loaded ? "loaded" : "loads on first use"}`)}
              {row("Pronunciation model (local)", data.pronunciation.available, data.pronunciation.error || data.pronunciation.model)}
              {row("Password-reset email", data.features.password_reset_email, data.features.password_reset_email ? "SMTP configured" : "SMTP not configured")}
            </TableBody>
          </Table>
        )}
        {data && <p className="mt-3 text-sm text-muted-foreground">Active transcription backend: {data.features.transcription}</p>}
      </CardContent>
    </Card>
  );
}

const EMPTY_EX = { exercise_type: "reading", difficulty: "beginner", title: "", content: "" };

function Exercises() {
  const [filter, setFilter] = useState({ type: "all", status: "all" });
  const q = new URLSearchParams();
  if (filter.type !== "all") q.set("type", filter.type);
  if (filter.status !== "all") q.set("status", filter.status);
  const { data, error, load } = useLoad<{ items: (Exercise & { status: string; flag_reason: string | null })[] }>(`/admin/exercises?${q}`);
  const [form, setForm] = useState(EMPTY_EX);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await api("/admin/exercises", { method: "POST", body: form });
      toast.success("Exercise added");
      setOpen(false);
      setForm(EMPTY_EX);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(id: string, status: string) {
    try {
      await api(`/admin/exercises/${id}`, { method: "PATCH", body: { status } });
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this exercise? Past attempts keep their frozen text.")) return;
    try {
      await api(`/admin/exercises/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exercises & generated content</CardTitle>
        <CardDescription>Add predefined exercises; review, hide or approve AI-generated and flagged content.</CardDescription>
        <div className="col-span-full mt-2 flex flex-wrap gap-2">
          <Select value={filter.type} onValueChange={(v) => setFilter({ ...filter, type: v })}>
            <SelectTrigger className="w-40" aria-label="Filter type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter.status} onValueChange={(v) => setFilter({ ...filter, status: v })}>
            <SelectTrigger className="w-36" aria-label="Filter status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="hidden">Hidden</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> Add exercise
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add predefined exercise</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Select value={form.exercise_type} onValueChange={(v) => setForm({ ...form, exercise_type: v })}>
                    <SelectTrigger aria-label="Type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TYPE_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={form.difficulty} onValueChange={(v) => setForm({ ...form, difficulty: v })}>
                    <SelectTrigger aria-label="Difficulty" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ex-title">Title</Label>
                  <Input id="ex-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ex-content">Text / question</Label>
                  <Textarea id="ex-content" rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={busy || !form.title || !form.content}>
                  {busy && <Loader2 className="animate-spin" />} Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive">{error}</p>}
        {!data ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exercise</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-md">
                      <div className="font-medium">{e.title}</div>
                      <div className="truncate text-sm text-muted-foreground">{e.content}</div>
                      {e.flag_reason && <div className="text-xs text-destructive">Flag: {e.flag_reason}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {TYPE_LABEL[e.exercise_type]} · <span className="capitalize">{e.difficulty}</span>
                    </TableCell>
                    <TableCell>{e.source === "ai" ? <Badge variant="secondary">AI · {e.ai_model}</Badge> : <Badge variant="outline">Predefined</Badge>}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === "active" ? "secondary" : e.status === "flagged" ? "destructive" : "outline"}>{e.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {e.status !== "active" && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, "active")}>
                          <CheckCircle2 /> Approve
                        </Button>
                      )}
                      {e.status !== "hidden" && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, "hidden")}>
                          <EyeOff /> Hide
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" onClick={() => remove(e.id)} aria-label="Delete exercise">
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Categories() {
  const cats = useLoad<{ items: any[] }>("/admin/categories");
  const levels = useLoad<{ items: any[] }>("/admin/difficulty-levels");
  const [form, setForm] = useState({ slug: "", name: "", exercise_type: "reading", description: "", is_active: true });

  async function addCat() {
    try {
      await api("/admin/categories", { method: "POST", body: form });
      setForm({ ...form, slug: "", name: "" });
      cats.load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function toggleCat(c: any) {
    try {
      await api(`/admin/categories/${c.id}`, { method: "PUT", body: { ...c, is_active: !c.is_active } });
      cats.load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function patchLevel(id: number, body: object) {
    try {
      await api(`/admin/difficulty-levels/${id}`, { method: "PATCH", body });
      levels.load();
      toast.success("Level updated");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Exercise categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="slug (e.g. reading-travel)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} aria-label="Category slug" />
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Category name" />
            <Select value={form.exercise_type} onValueChange={(v) => setForm({ ...form, exercise_type: v })}>
              <SelectTrigger className="w-full" aria-label="Category type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={addCat} disabled={!form.slug || !form.name}>
            <Plus /> Add category
          </Button>
          {cats.data && (
            <Table>
              <TableBody>
                {cats.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.slug} · {TYPE_LABEL[c.exercise_type as keyof typeof TYPE_LABEL]}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch checked={c.is_active} onCheckedChange={() => toggleCat(c)} aria-label={`Active: ${c.name}`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Difficulty levels</CardTitle>
          <CardDescription>Labels, descriptions and the reference-audio speed used for each level.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {levels.data?.items.map((lv) => (
            <div key={lv.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {lv.label} <span className="text-xs text-muted-foreground">({lv.code})</span>
                </span>
                <Switch checked={lv.is_active} onCheckedChange={(v) => patchLevel(lv.id, { is_active: v })} aria-label={`Active: ${lv.label}`} />
              </div>
              <Textarea defaultValue={lv.description} onBlur={(e) => e.target.value !== lv.description && patchLevel(lv.id, { description: e.target.value })} aria-label={`${lv.label} description`} rows={2} />
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor={`spd-${lv.id}`}>TTS speed</Label>
                <Input id={`spd-${lv.id}`} type="number" step={0.05} min={0.7} max={1.6} className="w-24" defaultValue={lv.tts_speed} onBlur={(e) => Number(e.target.value) !== lv.tts_speed && patchLevel(lv.id, { tts_speed: Number(e.target.value) })} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Users() {
  const { user: me } = useAuth();
  const { data, error, load } = useLoad<{ items: any[] }>("/admin/users");
  async function patch(id: string, body: object) {
    try {
      await api(`/admin/users/${id}`, { method: "PATCH", body });
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>Account administration only — learners&apos; transcripts and results are private.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive">{error}</p>}
        {data && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.display_name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{u.attempts}</TableCell>
                    <TableCell className="whitespace-nowrap">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Switch checked={u.role === "admin"} disabled={u.id === me?.id} onCheckedChange={(v) => patch(u.id, { role: v ? "admin" : "learner" })} aria-label={`Admin: ${u.email}`} />
                    </TableCell>
                    <TableCell>
                      <Switch checked={u.is_active} disabled={u.id === me?.id} onCheckedChange={(v) => patch(u.id, { is_active: v })} aria-label={`Active: ${u.email}`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Errors() {
  const { data, error, load } = useLoad<{ items: any[] }>("/admin/errors");
  return (
    <Card>
      <CardHeader>
        <CardTitle>System errors</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive">{error}</p>}
        {data && data.items.length === 0 && <p className="text-muted-foreground">No errors recorded.</p>}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {e.source} {e.status_code}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.path}</TableCell>
                    <TableCell className="max-w-md text-sm">{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== "admin")
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Administrator access required</h1>
      </div>
    );
  return (
    <div className="space-y-6">
      <PageHeader title="Administration" description="Manage content, monitor services and review aggregate usage." />
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="health">Service health</TabsTrigger>
          <TabsTrigger value="exercises">Exercises</TabsTrigger>
          <TabsTrigger value="categories">Categories & levels</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Overview />
        </TabsContent>
        <TabsContent value="health" className="mt-4">
          <Health />
        </TabsContent>
        <TabsContent value="exercises" className="mt-4">
          <Exercises />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <Categories />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <Users />
        </TabsContent>
        <TabsContent value="errors" className="mt-4">
          <Errors />
        </TabsContent>
      </Tabs>
    </div>
  );
}
