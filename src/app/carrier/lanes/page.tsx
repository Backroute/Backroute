"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useChartColors } from "@/components/shared/money-charts";
import { useToken } from "@/lib/theme";
import { useCarrierLoads } from "@/lib/selectors";
import { laneHistory } from "@/lib/lane-history";
import { cn } from "@/lib/utils";

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export default function LanesPage() {
  const loads = useCarrierLoads();
  const lanes = useMemo(() => laneHistory(loads), [loads]);
  const [picked, setPicked] = useState<string | null>(null);
  const lane = lanes.find((l) => l.key === picked) ?? lanes[0];
  const c = useChartColors();
  const brand = useToken("--brand", "#4f46e5");

  return (
    <div>
      <PageHeader title="Lanes" description="What you get paid on each lane against the market, month by month." />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        {lanes.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-ink-500">Once a lane has two booked loads it shows here, with your rate per mile next to the market&apos;s.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {lane && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{lane.label}</CardTitle>
                    <CardDescription>
                      {lane.loads} loads · you ${lane.yours.toFixed(2)}/mi, market ${lane.market.toFixed(2)}/mi ·{" "}
                      <span className={lane.vsMarket >= 0 ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]"}>
                        {lane.vsMarket >= 0 ? "+" : ""}
                        {Math.round(lane.vsMarket * 100)}% {lane.vsMarket >= 0 ? "over" : "under"} market
                      </span>
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="!pt-3">
                  <div className="h-56 w-full" role="img" aria-label={`Rate per mile on ${lane.label}: yours against the market, by month`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lane.points.map((p) => ({ ...p, label: monthLabel(p.month) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid stroke={c.line} vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: c.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: c.muted, fontSize: 11 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={(v: number) => `$${v.toFixed(2)}`} width={56} />
                        <Tooltip
                          contentStyle={{ background: c.surface, border: `1px solid ${c.line}`, borderRadius: 12, fontSize: 12 }}
                          formatter={(v, n) => [`$${Number(v).toFixed(2)}/mi`, n === "yours" ? "You" : "Market"]}
                        />
                        <Line type="monotone" dataKey="market" stroke={c.muted} strokeDasharray="4 4" strokeWidth={2} dot={false} name="market" />
                        <Line type="monotone" dataKey="yours" stroke={brand} strokeWidth={2.5} dot={{ r: 3, fill: brand }} name="yours" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 flex items-center gap-4 text-xs text-ink-500">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded bg-brand" /> You
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded border-t-2 border-dashed border-ink-400" /> Market
                    </span>
                  </p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Every lane</CardTitle>
                  <CardDescription>State to state, most loads first. Tap one to see it over time.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="!pt-3">
                <ul className="flex flex-col divide-y divide-line">
                  {lanes.map((l) => (
                    <li key={l.key}>
                      <button type="button" onClick={() => setPicked(l.key)} aria-pressed={lane?.key === l.key} className={cn("flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left", lane?.key === l.key && "bg-brand-soft")}>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink-950">{l.label}</span>
                          <span className="block text-xs text-ink-500">
                            {l.loads} loads · ${l.yours.toFixed(2)} vs ${l.market.toFixed(2)}/mi
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold tabular">
                          {l.trend !== 0 && (l.trend > 0 ? <TrendingUp className="h-4 w-4 text-[var(--accent-live)]" aria-label="Going up" /> : <TrendingDown className="h-4 w-4 text-[var(--accent-danger)]" aria-label="Going down" />)}
                          <span className={l.vsMarket >= 0 ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]"}>
                            {l.vsMarket >= 0 ? "+" : ""}
                            {Math.round(l.vsMarket * 100)}%
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
