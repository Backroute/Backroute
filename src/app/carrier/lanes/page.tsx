"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useChartColors } from "@/components/shared/money-charts";
import { useCarrierLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { laneHistory } from "@/lib/lane-history";
import { cn } from "@/lib/utils";

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export default function LanesPage() {
  const loads = useCarrierLoads();
  // A real account compares only against market rates from a rate service (Settings → Integrations); a load typed
  // in by hand carries its own rate, which isn't the market's.
  const real = useStore((s) => s.session.mode !== "demo");
  const lanes = useMemo(() => laneHistory(loads, { serviceOnly: real }), [loads, real]);
  const anyMarket = lanes.some((l) => l.market !== null);
  const [picked, setPicked] = useState<string | null>(null);
  const lane = lanes.find((l) => l.key === picked) ?? lanes[0];
  const c = useChartColors();
  const brand = c.ink;

  return (
    <div>
      <PageHeader title="Lanes" description={anyMarket || lanes.length === 0 ? "What you get paid on each lane against the market, month by month." : "What you get paid on each lane, month by month."} />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        {lanes.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-ink-500">Once a lane has two booked loads it shows here, with your rate per mile month by month.</p>
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
                      {lane.loads} loads · you ${lane.yours.toFixed(2)}/mi
                      {lane.market !== null && lane.vsMarket !== null ? (
                        <>
                          , market ${lane.market.toFixed(2)}/mi ·{" "}
                          <span className={lane.vsMarket >= 0 ? "text-ink-950" : "text-[var(--accent-danger)]"}>
                            {lane.vsMarket >= 0 ? "+" : ""}
                            {Math.round(lane.vsMarket * 100)}% {lane.vsMarket >= 0 ? "over" : "under"} market
                          </span>
                        </>
                      ) : (
                        " · no market rate yet (connect a rate service in Settings → Integrations)"
                      )}
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
                        {lane.market !== null && <Line type="monotone" dataKey="market" stroke={c.muted} strokeDasharray="4 4" strokeWidth={2} dot={false} name="market" connectNulls />}
                        <Line type="monotone" dataKey="yours" stroke={brand} strokeWidth={2.5} dot={{ r: 3, fill: brand }} name="yours" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 flex items-center gap-4 text-xs text-ink-500">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded bg-brand" /> You
                    </span>
                    {lane.market !== null && (
                      <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 rounded border-t-2 border-dashed border-ink-400" /> Market
                      </span>
                    )}
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
                            {l.loads} loads · ${l.yours.toFixed(2)}/mi{l.market !== null ? ` vs $${l.market.toFixed(2)} market` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold tabular">
                          {l.trend !== 0 && (l.trend > 0 ? <TrendingUp className="h-4 w-4 text-[var(--accent-live)]" aria-label="Going up" /> : <TrendingDown className="h-4 w-4 text-[var(--accent-danger)]" aria-label="Going down" />)}
                          {l.vsMarket !== null && (
                            <span className={l.vsMarket >= 0 ? "text-ink-950" : "text-[var(--accent-danger)]"}>
                              {l.vsMarket >= 0 ? "+" : ""}
                              {Math.round(l.vsMarket * 100)}%
                            </span>
                          )}
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
