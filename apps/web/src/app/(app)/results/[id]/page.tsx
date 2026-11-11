"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AttemptResult } from "@/components/practice/attempt-result";
import { api, errorMessage } from "@/lib/api";
import type { Attempt } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/types";

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ attempt: Attempt }>(`/attempts/${id}`)
      .then((r) => setAttempt(r.attempt))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  async function remove() {
    if (!confirm("Delete this attempt permanently?")) return;
    try {
      await api(`/attempts/${id}`, { method: "DELETE" });
      toast.success("Attempt deleted");
      router.replace("/history");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/history">
          <ArrowLeft /> History
        </Link>
      </Button>
      <PageHeader
        title={attempt ? `${TYPE_LABEL[attempt.exercise_type]} result` : "Result"}
        actions={
          attempt && (
            <Button variant="ghost" onClick={remove}>
              <Trash2 /> Delete
            </Button>
          )
        }
      />
      {error ? (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      ) : !attempt ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <AttemptResult attempt={attempt} onUpdate={setAttempt} />
      )}
    </div>
  );
}
