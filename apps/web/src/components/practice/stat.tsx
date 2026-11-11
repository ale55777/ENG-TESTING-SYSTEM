import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  unit,
  hint,
  emphasis,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("gap-1 py-4", className)}>
      <CardContent className="px-4">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          {label}
          {hint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`About ${label}`} className="text-muted-foreground hover:text-foreground">
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{hint}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className={cn("mt-1 font-semibold tabular-nums tracking-tight", emphasis ? "text-3xl" : "text-2xl")}>
          {value ?? "—"}
          {value !== null && value !== undefined && value !== "—" && unit && <span className="ml-0.5 text-base font-normal text-muted-foreground">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export function fmt(n: number | null | undefined, digits = 1): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Number(n).toFixed(digits).replace(/\.0+$/, "");
}
