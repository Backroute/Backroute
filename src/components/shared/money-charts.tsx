"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNow } from "@/lib/hooks";
import { isEarningLoad } from "@/lib/earnings";
import { useToken } from "@/lib/theme";
import type { Driver, Load, Truck } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const WEEKS = 8;
const WEEK = 7 * 86400_000;

/** Monday 00:00 local of the week `t` falls in. */
function mondayOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** When a load's money counts: the day it delivered, else the day it picks up, else when it came in. */
const dayOf = (l: Load) => Date.parse(l.tripChecklist?.unloadedAt ?? l.deliveryAt ?? l.pickupAt ?? l.createdAt);
const inOf = (l: Load) => l.invoice?.amount ?? l.bookedRate ?? 0;
const keptOf = (l: Load) => l.netProfit ?? inOf(l) - (l.fuelCost ?? 0) - (l.tollCost ?? 0) - (l.deadheadCost ?? 0) - (l.commission ?? 0);

interface WeekRow {
  week: string;
  start: number;
  in: number;
  spent: number;
  kept: number;
}

function weeksOf(loads: Load[], now: number): WeekRow[] {
  const first = mondayOf(now) - (WEEKS - 1) * WEEK;
  const rows: WeekRow[] = Array.from({ length: WEEKS }, (_, i) => {
    const start = first + i * WEEK;
    return { week: new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" }), start, in: 0, spent: 0, kept: 0 };
  });
  for (const l of loads) {
    const i = Math.floor((mondayOf(dayOf(l)) - first) / WEEK);
    if (i < 0 || i >= WEEKS) continue;
    const money = inOf(l);
    const kept = keptOf(l);
    rows[i].in += money;
    rows[i].kept += kept;
    rows[i].spent += Math.max(0, money - kept);
  }
  return rows;
}

const k = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`);

/** Chart colors from the theme, so the charts follow light and dark. */
export function useChartColors() {
  return {
    ink: useToken("--ink-950", "#0a0a08"),
    muted: useToken("--ink-400", "#73736b"),
    soft: useToken("--ink-200", "#dfdfdb"),
    line: useToken("--line", "#e4e4e0"),
    surface: useToken("--color-white", "#ffffff"),
    live: useToken("--accent-live", "#0f8a4b"),
  };
}

/**
 * The money over the last eight weeks: what came in, what it cost, what was kept (bars), then the same "kept" line
 * for each truck and each of the busiest lanes, so a weak truck or a bad lane shows at a glance.
 */
export function MoneyCharts({ loads, trucks, drivers }: { loads: Load[]; trucks: Truck[]; drivers: Map<string, Driver> }) {
  const now = useNow();
  const c = useChartColors();
  const earning = useMemo(() => loads.filter((l) => isEarningLoad(l) && !l.imported), [loads]);
  const weeks = useMemo(() => (now === null ? [] : weeksOf(earning, now)), [earning, now]);
  const perTruck = useMemo(
    () =>
      now === null
        ? []
        : trucks
            .map((t) => {
              const rows = weeksOf(earning.filter((l) => l.truckId === t.id), now);
              return { id: t.id, label: t.unitNumber, sub: drivers.get(t.driverId ?? "")?.name ?? "Unassigned", rows, total: rows.reduce((s, r) => s + r.kept, 0) };
            })
            .sort((a, b) => b.total - a.total),
    [earning, trucks, drivers, now],
  );
  const perLane = useMemo(() => {
    if (now === null) return [];
    const by = new Map<string, Load[]>();
    for (const l of earning) {
      const key = `${l.lane.origin}, ${l.lane.originState} → ${l.lane.destination}, ${l.lane.destState}`;
      by.set(key, [...(by.get(key) ?? []), l]);
    }
    return [...by.entries()]
      .map(([label, ls]) => {
        const rows = weeksOf(ls, now);
        return { id: label, label, sub: `${ls.length} load${ls.length === 1 ? "" : "s"}`, rows, total: rows.reduce((s, r) => s + r.kept, 0) };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [earning, now]);

  if (now === null) return null;
  const any = weeks.some((w) => w.in > 0);
  const tooltip = {
    contentStyle: { borderRadius: 12, border: `1px solid ${c.line}`, fontSize: 12, background: c.surface, color: c.ink },
    cursor: { fill: c.soft, opacity: 0.4 },
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Money by week</CardTitle>
            <CardDescription>What came in, what it cost (fuel, tolls, empty miles, fees) and what you kept. Last 8 weeks.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="!pt-4">
          {any ? (
            <>
              <div className="h-64 w-full" role="img" aria-label={`Weekly money: ${weeks.map((w) => `${w.week}, ${formatCurrency(w.in)} in, ${formatCurrency(w.kept)} kept`).join("; ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeks} margin={{ left: -8, right: 8, top: 8 }}>
                    <CartesianGrid stroke={c.line} vertical={false} />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: c.muted }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: c.muted }} tickFormatter={k} width={48} />
                    <Tooltip
                      {...tooltip}
                      formatter={(value, key) => [formatCurrency(Number(value)), key === "kept" ? "Kept" : "Spent"]}
                      labelFormatter={(label, items) => {
                        const row = items?.[0]?.payload as WeekRow | undefined;
                        return `Week of ${label}${row ? ` · ${formatCurrency(row.in)} in` : ""}`;
                      }}
                    />
                    <Bar dataKey="kept" stackId="m" fill={c.live} radius={[0, 0, 4, 4]} />
                    <Bar dataKey="spent" stackId="m" fill={c.soft} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
                <li className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.live }} /> Kept
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.soft }} /> Spent
                </li>
                <li className="text-ink-500">The whole bar is what came in.</li>
              </ul>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-ink-500">No booked loads in the last 8 weeks yet. The bars fill in as loads deliver.</p>
          )}
        </CardContent>
      </Card>

      {any && (
        <div className="grid gap-6 lg:grid-cols-2">
          <TrendList title="Kept per truck" description="Each truck's last 8 weeks. A flat or falling line is the one to look at." items={perTruck} colors={c} />
          <TrendList title="Kept per lane" description="Your five best-paying lanes, week by week." items={perLane} colors={c} />
        </div>
      )}
    </div>
  );
}

function TrendList({
  title,
  description,
  items,
  colors,
}: {
  title: string;
  description: string;
  items: { id: string; label: string; sub: string; rows: WeekRow[]; total: number }[];
  colors: ReturnType<typeof useChartColors>;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="!pt-3">
        <ul className="flex flex-col divide-y divide-line">
          {items.map((it) => {
            const last = it.rows.at(-1)?.kept ?? 0;
            const before = it.rows.at(-2)?.kept ?? 0;
            const down = last < before;
            return (
              <li key={it.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-950">{it.label}</p>
                  <p className="truncate text-xs text-ink-500">{it.sub}</p>
                </div>
                <div className="h-9 w-28 shrink-0" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={it.rows} margin={{ top: 4, bottom: 4, left: 2, right: 2 }}>
                      <Line type="monotone" dataKey="kept" stroke={down ? colors.muted : colors.live} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-20 shrink-0 text-right">
                  <p className="text-sm font-semibold tabular text-ink-950">{formatCurrency(it.total)}</p>
                  <p className={`text-[11px] tabular ${down ? "text-[var(--accent-danger)]" : "text-ink-500"}`}>{down ? "down this week" : "8 weeks"}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
