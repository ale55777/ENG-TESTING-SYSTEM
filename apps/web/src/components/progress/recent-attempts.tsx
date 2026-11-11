"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt } from "@/components/practice/stat";
import type { AttemptSummary } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/types";

export function headlineScore(a: AttemptSummary): string {
  switch (a.exercise_type) {
    case "typing":
      return `${fmt(a.typing_wpm, 0) ?? "—"} WPM · ${fmt(a.typing_accuracy) ?? "—"}%`;
    case "speaking":
      return a.speaking_overall !== null ? `${fmt(a.speaking_overall)}/9 est.` : "feedback pending";
    case "pronunciation":
      return a.pronunciation_score !== null ? `${fmt(a.pronunciation_score)}/100` : "—";
    default:
      return `${fmt(a.word_accuracy) ?? "—"}% words${a.pronunciation_score !== null ? ` · ${fmt(a.pronunciation_score)} pron.` : ""}`;
  }
}

export function RecentAttemptsTable({ items, actions }: { items: AttemptSummary[]; actions?: (a: AttemptSummary) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Exercise</TableHead>
            <TableHead className="hidden md:table-cell">Text</TableHead>
            <TableHead>Result</TableHead>
            {actions && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-nowrap">
                <Link href={`/results/${a.id}`} className="hover:underline">
                  {new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{TYPE_LABEL[a.exercise_type]}</Badge>
              </TableCell>
              <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">{a.reference_preview}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{headlineScore(a)}</TableCell>
              {actions && <TableCell className="text-right">{actions(a)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
