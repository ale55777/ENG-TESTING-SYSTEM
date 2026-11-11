"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthCard } from "@/components/auth-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { User } from "@/lib/types";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

export function LoginForm() {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetAvailable, setResetAvailable] = useState(false);

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, router, next]);
  useEffect(() => {
    api<{ available: boolean }>("/auth/password-reset/available").then((r) => setResetAvailable(r.available)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/login", { method: "POST", body: { email, password } });
      setUser(r.user);
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Log in to continue practising."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
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
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            {resetAvailable && (
              <Link href="/reset-password" className="text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            )}
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Log in
        </Button>
        {!resetAvailable && <p className="text-center text-xs text-muted-foreground">Forgot your password? Ask an administrator — email reset is not configured on this server.</p>}
      </form>
    </AuthCard>
  );
}
