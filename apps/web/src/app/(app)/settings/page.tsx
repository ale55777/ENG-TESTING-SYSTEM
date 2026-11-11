"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, LogOut, Save, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TtsPlayer, VOICES } from "@/components/practice/tts-player";
import { MicrophoneSettings } from "@/components/settings/microphone-settings";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { User } from "@/lib/types";

export default function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<Partial<User>>({});
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [health, setHealth] = useState<{ features: Record<string, unknown>; privacy: { external_processing: string } } | null>(null);

  useEffect(() => {
    if (user) setForm(user);
  }, [user]);
  useEffect(() => {
    api<typeof health>("/health").then(setHealth).catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api<{ user: User }>("/profile", {
        method: "PATCH",
        body: {
          display_name: form.display_name,
          proficiency_level: form.proficiency_level,
          learning_goals: form.learning_goals,
          preferred_difficulty: form.preferred_difficulty,
          preferred_voice: form.preferred_voice,
          playback_speed: form.playback_speed,
          daily_goal_minutes: form.daily_goal_minutes,
        },
      });
      setUser(r.user);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    try {
      await api("/profile/password", { method: "POST", body: pw });
      setPw({ current_password: "", new_password: "" });
      toast.success("Password changed");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPwBusy(false);
    }
  }

  if (!user) return null;
  const levelSelect = (key: "proficiency_level" | "preferred_difficulty", label: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={(form[key] as string) || "beginner"} onValueChange={(v) => setForm({ ...form, [key]: v as User["proficiency_level"] })}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="beginner">Beginner</SelectItem>
          <SelectItem value="intermediate">Intermediate</SelectItem>
          <SelectItem value="advanced">Advanced</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Profile & settings" />
      <form onSubmit={save}>
        <Card>
          <CardHeader>
            <CardTitle>Profile and learning preferences</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dn">Display name</Label>
              <Input id="dn" required maxLength={80} value={form.display_name || ""} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            {levelSelect("proficiency_level", "Proficiency level")}
            {levelSelect("preferred_difficulty", "Preferred exercise difficulty")}
            <div className="space-y-1.5">
              <Label htmlFor="goal">Daily goal (minutes)</Label>
              <Input id="goal" type="number" min={5} max={240} value={form.daily_goal_minutes ?? 15} onChange={(e) => setForm({ ...form, daily_goal_minutes: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="goals">Learning goals</Label>
              <Textarea id="goals" maxLength={1000} placeholder="e.g. Speak more fluently in meetings, prepare for IELTS speaking" value={form.learning_goals || ""} onChange={(e) => setForm({ ...form, learning_goals: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Reference voice</Label>
              <Select value={form.preferred_voice || "F1"} onValueChange={(v) => setForm({ ...form, preferred_voice: v })}>
                <SelectTrigger className="w-full" aria-label="Reference voice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICES.map((v) => (
                    <SelectItem key={v} value={v}>
                      Voice {v} ({v.startsWith("F") ? "female" : "male"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default playback speed</Label>
              <Select value={String(form.playback_speed ?? 1)} onValueChange={(v) => setForm({ ...form, playback_speed: Number(v) })}>
                <SelectTrigger className="w-full" aria-label="Playback speed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0.8, 0.9, 1, 1.1, 1.25].map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}×
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <TtsPlayer key={`${form.preferred_voice}`} text="Hello! This is how your reference voice sounds." label="Preview voice" compact />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Save changes
            </Button>
          </CardFooter>
        </Card>
      </form>

      <MicrophoneSettings />

      <form onSubmit={changePassword}>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp">Current password</Label>
              <Input id="cp" type="password" autoComplete="current-password" required value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np">New password</Label>
              <Input id="np" type="password" autoComplete="new-password" required minLength={8} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
              <p className="text-xs text-muted-foreground">At least 8 characters with letters and numbers.</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="secondary" disabled={pwBusy}>
              {pwBusy && <Loader2 className="animate-spin" />} Update password
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" aria-hidden /> Privacy & data
          </CardTitle>
          <CardDescription>What happens to your data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Microphone audio is processed in memory and is never stored — not even for administrators.</li>
            <li>{health?.privacy.external_processing ?? "Audio may be sent to GroqCloud for transcription when configured."}</li>
            <li>Saved: exercise text, transcripts, word comparisons, scores and feedback, so you can review your progress.</li>
            <li>Administrators can see aggregate usage statistics, not your transcripts or results.</li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              onClick={async () => {
                await api("/auth/logout-all", { method: "POST" }).catch(() => {});
                await logout();
                router.replace("/login");
              }}
            >
              <LogOut /> Log out of all devices
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm("Delete all practice history permanently?")) return;
                try {
                  const r = await api<{ deleted_attempts: number }>("/profile/history", { method: "DELETE" });
                  toast.success(`Deleted ${r.deleted_attempts} attempts`);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <Trash2 /> Delete practice history
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 /> Delete account
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete your account?</DialogTitle>
                  <DialogDescription>Your account, profile and all practice data will be permanently deleted. Enter your password to confirm.</DialogDescription>
                </DialogHeader>
                <Input type="password" autoComplete="current-password" placeholder="Password" value={delPw} onChange={(e) => setDelPw(e.target.value)} aria-label="Password" />
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    disabled={!delPw}
                    onClick={async () => {
                      try {
                        await api("/profile/delete-account", { method: "POST", body: { password: delPw } });
                        setUser(null);
                        router.replace("/");
                        toast.success("Your account has been deleted");
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  >
                    Delete permanently
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
