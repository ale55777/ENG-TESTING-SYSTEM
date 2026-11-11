"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthCard } from "@/components/auth-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { User } from "@/lib/types";

export default function RegisterPage() {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ display_name: "", email: "", password: "", proficiency_level: "beginner" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  const pwOk = form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pwOk) {
      setError("Password must be at least 8 characters and contain letters and numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/register", { method: "POST", body: form });
      setUser(r.user);
      router.replace("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description="Free English speaking, pronunciation and typing practice."
      footer={
        <>
          Already registered?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="name">Display name</Label>
          <Input id="name" required maxLength={80} autoComplete="nickname" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required autoComplete="new-password" aria-describedby="pw-help" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <p id="pw-help" className={`text-xs ${form.password && !pwOk ? "text-destructive" : "text-muted-foreground"}`}>
            At least 8 characters, with letters and numbers.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Your English level</Label>
          <Select value={form.proficiency_level} onValueChange={(v) => setForm({ ...form, proficiency_level: v })}>
            <SelectTrigger className="w-full" aria-label="English level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">Beginner — simple words and short sentences</SelectItem>
              <SelectItem value="intermediate">Intermediate — longer sentences, some complex grammar</SelectItem>
              <SelectItem value="advanced">Advanced — complex texts and extended speaking</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">You can change this at any time in Settings.</p>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Create account
        </Button>
      </form>
    </AuthCard>
  );
}
