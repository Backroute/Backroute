"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { usePrimaryCarrier, useCarrierLoads, useCarrierTrucks, useBrokerMap, useDriverMap } from "@/lib/selectors";
import { weekEarnings } from "@/lib/earnings";
import { formatCurrency } from "@/lib/utils";

const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];

export default function EarningsPage() {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();
  const brokers = useBrokerMap();
  const driverMap = useDriverMap();
  const week = weekEarnings(loads);
  const perTruck = trucks
    .map((t) => ({ truck: t, driver: driverMap.get(t.driverId ?? ""), w: weekEarnings(loads.filter((l) => l.truckId === t.id)) }))
    .sort((a, b) => b.w.net - a.w.net);

  const delivered = loads.filter((l) => l.stage === "delivered");
  const netProfitTotal = loads.reduce((s, l) => s + (l.netProfit ?? 0), 0);
  const avgRpm = (() => {
    const withRpm = loads.filter((l) => l.rpm);
    return withRpm.length ? withRpm.reduce((s, l) => s + (l.rpm ?? 0), 0) / withRpm.length : 0;
  })();
  const deadheadMiles = loads.reduce((s, l) => s + l.deadheadMiles, 0);
  const totalMiles = loads.reduce((s, l) => s + l.lane.miles, 0) + deadheadMiles;
  const emptyRate = totalMiles ? (deadheadMiles / totalMiles) * 100 : 0;

  const revenueTrend = MONTHS.map((m, i) => ({
    month: m,
    revenue: Math.round(carrier.gmvMonth * (0.72 + i * 0.052)),
    saved: Math.round(carrier.avgSavingsPerTruck * trucks.length * (0.68 + i * 0.06)),
  }));

  const costComparison = [
    { name: "Industry avg", value: 1500 },
    { name: "Backroute", value: 539 },
  ];

  const priced = loads.filter((l) => l.netProfit !== null);
  const byLane = new Map<string, { total: number; count: number }>();
  const byBroker = new Map<string, { total: number; count: number }>();
  const byEquip = new Map<string, { total: number; count: number }>();
  let rpmSum = 0, marketRpmSum = 0, rpmCount = 0;

  for (const l of priced) {
    const laneKey = `${l.lane.origin} → ${l.lane.destination}`;
    const laneEntry = byLane.get(laneKey) ?? { total: 0, count: 0 };
    laneEntry.total += l.netProfit ?? 0;
    laneEntry.count += 1;
    byLane.set(laneKey, laneEntry);

    const brokerEntry = byBroker.get(l.brokerId) ?? { total: 0, count: 0 };
    brokerEntry.total += l.netProfit ?? 0;
    brokerEntry.count += 1;
    byBroker.set(l.brokerId, brokerEntry);

    const equipEntry = byEquip.get(l.equipmentType) ?? { total: 0, count: 0 };
    equipEntry.total += l.netProfit ?? 0;
    equipEntry.count += 1;
    byEquip.set(l.equipmentType, equipEntry);

    if (l.rpm) {
      rpmSum += l.rpm;
      marketRpmSum += l.lane.marketRpm;
      rpmCount += 1;
    }
  }

  function bestOf(map: Map<string, { total: number; count: number }>) {
    let best: { key: string; avg: number } | null = null;
    for (const [key, v] of map) {
      const avg = v.total / v.count;
      if (!best || avg > best.avg) best = { key, avg };
    }
    return best;
  }
  function worstOf(map: Map<string, { total: number; count: number }>) {
    let worst: { key: string; avg: number } | null = null;
    for (const [key, v] of map) {
      const avg = v.total / v.count;
      if (!worst || avg < worst.avg) worst = { key, avg };
    }
    return worst;
  }

  const bestLane = bestOf(byLane);
  const worstBrokerEntry = worstOf(byBroker);
  const worstBrokerName = worstBrokerEntry ? brokers.get(worstBrokerEntry.key)?.company ?? "that broker" : null;
  const bestEquip = bestOf(byEquip);
  const avgRpmAll = rpmCount ? rpmSum / rpmCount : 0;
  const avgMarketRpm = rpmCount ? marketRpmSum / rpmCount : 0;
  const rateFloorNote =
    avgRpmAll >= avgMarketRpm * 1.02
      ? "You're consistently beating market rate. Worth testing a higher rate floor."
      : "You're tracking close to market rate. Hold your current floor for now.";

  return (
    <div>
      <PageHeader title="Earnings" />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <section className="rounded-3xl bg-ink-950 p-5 text-white sm:p-6" aria-labelledby="week-title">
          <p id="week-title" className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/50">
            <Sparkles className="h-3.5 w-3.5" /> This week
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-4xl font-semibold tabular tracking-tight">{formatCurrency(week.net)}</p>
              <p className="mt-1 text-sm text-white/60">net profit on {formatCurrency(week.gross)} revenue · {week.loads.length} loads</p>
            </div>
            {week.overMarket > 0 && (
              <p className="flex items-center gap-1.5 rounded-2xl bg-emerald-400/15 px-3.5 py-2 text-sm font-medium text-emerald-200">
                <TrendingUp className="h-4 w-4" /> AI earned you {formatCurrency(week.overMarket)} more than market
              </p>
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <WeekTile label="Revenue / mile, all miles" value={`$${week.rpmAll.toFixed(2)}`} />
            <WeekTile label="Empty miles" value={`${week.emptyPct.toFixed(0)}%`} sub="Industry ~20%" />
            <WeekTile label="Above posted rates" value={`+${formatCurrency(week.overPosted)}`} />
            <WeekTile label="Detention billed by AI" value={week.extras ? `+${formatCurrency(week.extras)}` : "$0"} />
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-white/55">
            <Clock className="h-3.5 w-3.5" /> {week.hoursSaved} hours of dispatcher work done by the AI this week: broker calls, emails, rate cons, check calls and paperwork.
          </p>
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Profit by truck</CardTitle>
              <CardDescription>This week. The AI plans each truck&apos;s next loads to lift the weakest ones.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                    <th className="pb-2 font-medium">Truck</th>
                    <th className="pb-2 font-medium">Loads</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
                    <th className="pb-2 text-right font-medium">Net</th>
                    <th className="pb-2 text-right font-medium">$/mi all miles</th>
                    <th className="pb-2 text-right font-medium">Empty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {perTruck.map(({ truck, driver, w }) => (
                    <tr key={truck.id}>
                      <td className="py-2.5">
                        <p className="font-medium text-ink-950">{truck.unitNumber}</p>
                        <p className="text-xs text-ink-500">{driver?.name ?? "Unassigned"}</p>
                      </td>
                      <td className="py-2.5 tabular text-ink-700">{w.loads.length}</td>
                      <td className="py-2.5 text-right tabular text-ink-700">{formatCurrency(w.gross)}</td>
                      <td className="py-2.5 text-right font-semibold tabular text-ink-950">{formatCurrency(w.net)}</td>
                      <td className="py-2.5 text-right tabular text-ink-700">{w.rpmAll ? `$${w.rpmAll.toFixed(2)}` : "—"}</td>
                      <td className={`py-2.5 text-right tabular ${w.emptyPct > 20 ? "text-[var(--accent-danger)]" : "text-ink-700"}`}>
                        {w.loads.length ? `${w.emptyPct.toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card><CardContent><StatTile label="Net profit" value={formatCurrency(netProfitTotal)} sublabel="This cycle" /></CardContent></Card>
          <Card><CardContent><StatTile label="Avg rate / mile" value={`$${avgRpm.toFixed(2)}`} /></CardContent></Card>
          <Card><CardContent><StatTile label="Loads delivered" value={delivered.length} /></CardContent></Card>
          <Card><CardContent><StatTile label="Empty-mile rate" value={`${emptyRate.toFixed(1)}%`} sublabel="Industry avg is ~20%" trend={{ direction: "down", value: "cut by load chaining", good: true }} /></CardContent></Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Revenue & savings trend</CardTitle>
            </CardHeader>
            <CardContent className="!pt-4">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueTrend} margin={{ left: -12, right: 12, top: 8 }}>
                    <CartesianGrid stroke="#e4e4e0" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} />
                    <YAxis
                      yAxisId="revenue"
                      domain={[(min: number) => Math.floor(min * 0.9), (max: number) => Math.ceil(max * 1.05)]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: "#9d9d95" }}
                      tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                      width={48}
                    />
                    <YAxis
                      yAxisId="saved"
                      orientation="right"
                      domain={[(min: number) => Math.floor(min * 0.9), (max: number) => Math.ceil(max * 1.05)]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: "#0f8a4b" }}
                      tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                      width={48}
                    />
                    <Tooltip
                      formatter={(value, key) => [formatCurrency(Number(value)), key === "revenue" ? "GMV" : "Saved vs. human dispatch"]}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e0", fontSize: 12 }}
                    />
                    <Line yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#0a0a0a" strokeWidth={2} dot={false} />
                    <Line yAxisId="saved" type="monotone" dataKey="saved" stroke="#0f8a4b" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cost per truck / month</CardTitle>
            </CardHeader>
            <CardContent className="!pt-4">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costComparison} margin={{ left: -12, right: 12, top: 8 }}>
                    <CartesianGrid stroke="#e4e4e0" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} tickFormatter={(v) => `$${v}`} width={48} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e0", fontSize: 12 }} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#0a0a0a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-xs text-ink-500">
                About <span className="font-medium text-ink-900">{formatCurrency(1500 - 539)}</span> saved per truck, per month. {formatCurrency((1500 - 539) * trucks.length)} across your fleet.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><Lightbulb className="h-4 w-4" /> Weekly insights</CardTitle>
              <CardDescription>Where your fleet makes the most and least money.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            {priced.length === 0 ? (
              <p className="text-sm text-ink-400">Not enough delivered loads yet to generate insights.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {bestLane && (
                  <InsightRow label="Best lane" detail={bestLane.key} value={`${formatCurrency(bestLane.avg)} avg net`} tone="success" />
                )}
                {worstBrokerEntry && worstBrokerName && (
                  <InsightRow label="Lowest-margin broker" detail={worstBrokerName} value={`${formatCurrency(worstBrokerEntry.avg)} avg net`} tone="danger" />
                )}
                {bestEquip && (
                  <InsightRow label="Most profitable equipment" detail={bestEquip.key} value={`${formatCurrency(bestEquip.avg)} avg net`} tone="success" />
                )}
                <InsightRow label="Rate floor" detail={rateFloorNote} tone="info" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InsightRow({ label, detail, value, tone }: { label: string; detail: string; value?: string; tone: "success" | "danger" | "info" }) {
  const toneClass = tone === "success" ? "text-[var(--accent-live)]" : tone === "danger" ? "text-[var(--accent-danger)]" : "text-ink-500";
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink-950">{detail}</p>
      {value && <p className={`mt-0.5 text-xs font-medium tabular ${toneClass}`}>{value}</p>}
    </div>
  );
}

function WeekTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white/5 px-3.5 py-3">
      <p className="text-lg font-semibold tabular">{value}</p>
      <p className="text-[11px] text-white/50">{label}{sub ? ` · ${sub}` : ""}</p>
    </div>
  );
}
