"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, History, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RecentAttemptsTable } from "@/components/progress/recent-attempts";
import { api, errorMessage } from "@/lib/api";
import type { AttemptSummary } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/types";

const PAGE = 20;

export default function HistoryPage() {
  const [type, setType] = useState("all");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: AttemptSummary[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (type !== "all") q.set("type", type);
      setData(await api(`/attempts?${q}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [type, offset]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    try {
      await api(`/attempts/${id}`, { method: "DELETE" });
      toast.success("Attempt deleted");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeAll() {
    try {
      const r = await api<{ deleted_attempts: number }>("/profile/history", { method: "DELETE" });
      toast.success(`Deleted ${r.deleted_attempts} attempts`);
      setOffset(0);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Practice history"
        description="Review past attempts, compare scores, repeat exercises or delete your data."
        actions={
          <>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Filter by exercise type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All exercises</SelectItem>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!data?.total}>
                  <Trash2 /> Delete all
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete your entire practice history?</DialogTitle>
                  <DialogDescription>All attempts, transcripts, scores, feedback and progress statistics will be permanently deleted. This cannot be undone.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive" onClick={removeAll}>
                      Delete everything
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />
      {error && <p className="text-destructive" role="alert">{error}</p>}
      <Card>
        <CardContent>
          {!data ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : data.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <History className="size-10 text-muted-foreground" aria-hidden />
              <p className="text-muted-foreground">No attempts {type !== "all" ? "of this type " : ""}yet.</p>
              <Button asChild>
                <Link href="/practice/reading">Start practising</Link>
              </Button>
            </div>
          ) : (
            <>
              <RecentAttemptsTable
                items={data.items}
                actions={(a) => (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon-sm" asChild aria-label="View result">
                      <Link href={`/results/${a.id}`}>
                        <Eye />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Delete attempt" onClick={() => remove(a.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
              />
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    <ChevronLeft /> Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                    Next <ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
