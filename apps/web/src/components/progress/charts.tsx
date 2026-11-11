"use client";

/**
 * Progress charts (Recharts). Conventions: one measure per chart (no dual axes), categorical colours
 * in fixed order from the theme (--chart-1..3), 2px lines, >=8px markers, recessive grid, hover
 * tooltips, and a table view for every chart.
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Point = Record<string, string | number | null | undefined> & { at?: string; day?: string };

const shortDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function ChartFrame({
  title,
  description,
  children,
  table,
  empty,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  table: React.ReactNode;
  empty: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {!empty && (
          <CardAction>
            <Button variant="ghost" size="xs" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
              {showTable ? "Chart" : "Table"}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">No data yet — complete an exercise to see this chart.</p>
        ) : showTable ? (
          <div className="max-h-56 overflow-auto">{table}</div>
        ) : (
          <div className="h-56 w-full">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

const axisProps = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 12 },
  labelStyle: { color: "var(--muted-foreground)" },
};

export function TrendChart({
  title,
  description,
  data,
  dataKey,
  unit = "",
  colorVar,
  domain,
}: {
  title: string;
  description?: string;
  data: Point[] | undefined;
  dataKey: string;
  unit?: string;
  colorVar: string;
  domain?: [number, number];
}) {
  const pts = (data || []).filter((p) => p[dataKey] !== null && p[dataKey] !== undefined).map((p, i) => ({ ...p, n: i + 1 }) as Point & { n: number });
  return (
    <ChartFrame
      title={title}
      description={description}
      empty={pts.length === 0}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">{title}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pts.map((p) => (
              <TableRow key={String(p.n)}>
                <TableCell>{new Date(String(p.at)).toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(p[dataKey]).toFixed(1)}
                  {unit}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="at" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
          <YAxis domain={domain ?? ["auto", "auto"]} {...axisProps} width={44} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(l) => new Date(String(l)).toLocaleString()}
            formatter={(v) => [`${Number(v).toFixed(1)}${unit}`, title]}
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
          />
          <Line type="monotone" dataKey={dataKey} stroke={`var(${colorVar})`} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }} activeDot={{ r: 6 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Up to three series sharing one scale (e.g. speaking estimates 0-9). */
export function MultiTrendChart({
  title,
  description,
  data,
  series,
  domain,
}: {
  title: string;
  description?: string;
  data: Point[] | undefined;
  series: { key: string; label: string; colorVar: string }[];
  domain?: [number, number];
}) {
  const pts = (data || []).filter((p) => series.some((s) => p[s.key] !== null && p[s.key] !== undefined));
  return (
    <ChartFrame
      title={title}
      description={description}
      empty={pts.length === 0}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {series.map((s) => (
                <TableHead key={s.key} className="text-right">
                  {s.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pts.map((p, i) => (
              <TableRow key={i}>
                <TableCell>{new Date(String(p.at)).toLocaleString()}</TableCell>
                {series.map((s) => (
                  <TableCell key={s.key} className="text-right tabular-nums">
                    {p[s.key] ?? "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="at" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
          <YAxis domain={domain ?? ["auto", "auto"]} {...axisProps} width={44} />
          <Tooltip {...tooltipStyle} labelFormatter={(l) => new Date(String(l)).toLocaleString()} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Line key={s.key} name={s.label} type="monotone" dataKey={s.key} stroke={`var(${s.colorVar})`} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function DailyBarChart({ title, description, data, dataKey, unit = "", colorVar }: { title: string; description?: string; data: Point[]; dataKey: string; unit?: string; colorVar: string }) {
  const pts = data.filter((p) => p[dataKey] !== null && p[dataKey] !== undefined);
  return (
    <ChartFrame
      title={title}
      description={description}
      empty={pts.length === 0}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead className="text-right">{title}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pts.map((p) => (
              <TableRow key={String(p.day)}>
                <TableCell>{String(p.day)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p[dataKey]}
                  {unit}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={pts} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tickFormatter={(d) => shortDate(String(d) + "T12:00:00")} {...axisProps} minTickGap={16} />
          <YAxis allowDecimals={false} {...axisProps} width={44} />
          <Tooltip {...tooltipStyle} formatter={(v) => [`${v}${unit}`, title]} cursor={{ fill: "var(--accent)" }} />
          <Bar dataKey={dataKey} fill={`var(${colorVar})`} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
