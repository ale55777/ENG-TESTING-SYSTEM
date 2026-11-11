"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthCard } from "@/components/auth-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";

export function ResetForm() {
  const token = useSearchParams().get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/auth/password-reset/request", { method: "POST", body: { email } });
      setMsg({ ok: true, text: r.message });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/password-reset/confirm", { method: "POST", body: { token, new_password: password } });
      setMsg({ ok: true, text: "Your password has been reset. You can now log in." });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={token ? "Choose a new password" : "Reset your password"}
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Back to log in
        </Link>
      }
    >
      {msg && (
        <Alert variant={msg.ok ? "default" : "destructive"} className="mb-4">
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}
      {token ? (
        <form onSubmit={confirm} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="np">New password</Label>
            <Input id="np" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Set new password
          </Button>
        </form>
      ) : (
        <form onSubmit={request} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
