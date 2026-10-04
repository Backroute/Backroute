"use client";

import { MoneyCharts } from "@/components/shared/money-charts";
import { Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { useCarrierLoads, useCarrierTrucks, useBrokerMap, useDriverMap } from "@/lib/selectors";
import { weekEarnings } from "@/lib/earnings";
import { formatCurrency } from "@/lib/utils";

export default function EarningsPage() {
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
        {/* Bento: the week's number is the big tile, everything that explains it sits around it in smaller ones. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <section className="theme-ink col-span-2 flex flex-col justify-between rounded-3xl bg-ink-950 p-5 text-white sm:p-6 lg:row-span-2" aria-labelledby="week-title">
            <div>
              <p id="week-title" className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/50">
                <Sparkles className="h-3.5 w-3.5" /> This week
              </p>
              <p className="mt-3 text-5xl font-semibold tabular tracking-tight">{formatCurrency(week.net)}</p>
              <p className="mt-1 text-sm text-white/60">
                net profit on {formatCurrency(week.gross)} revenue · {week.loads.length} loads
              </p>
            </div>
            {week.overMarket > 0 && (
              <p className="mt-6 flex w-fit items-center gap-1.5 rounded-2xl bg-white/10 px-3.5 py-2 text-sm font-medium text-white/85">
                <TrendingUp className="h-4 w-4" /> AI earned you {formatCurrency(week.overMarket)} more than market
              </p>
            )}
          </section>
          <BentoTile label="Revenue / mile, all miles" value={`$${week.rpmAll.toFixed(2)}`} />
          <BentoTile label="Empty miles" value={`${week.emptyPct.toFixed(0)}%`} tone={week.emptyPct > 20 ? "danger" : undefined} />
          <BentoTile label="Above posted rates" value={`+${formatCurrency(week.overPosted)}`} tone={week.overPosted > 0 ? "live" : undefined} />
          <BentoTile label="Detention billed by AI" value={week.extras ? `+${formatCurrency(week.extras)}` : "$0"} />

          <section aria-labelledby="trucks-title" className="col-span-2 rounded-3xl border border-line bg-white p-5 lg:row-span-2">
            <h3 id="trucks-title" className="t-section text-ink-950">
              Profit by truck
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">This week. The AI plans each truck&apos;s next loads to lift the weakest ones.</p>
            <ul className="mt-4 flex flex-col gap-3">
              {perTruck.slice(0, 5).map(({ truck, driver, w }) => {
                const top = Math.max(1, ...perTruck.map((p) => p.w.net));
                return (
                  <li key={truck.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm">
                        <span className="font-medium text-ink-950">{truck.unitNumber}</span> <span className="text-ink-500">{driver?.name ?? "Unassigned"}</span>
                      </p>
                      <p className="text-sm font-semibold tabular text-ink-950">{formatCurrency(w.net)}</p>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (Math.max(0, w.net) / top) * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-xs tabular text-ink-500">
                      {w.loads.length} load{w.loads.length === 1 ? "" : "s"} · {formatCurrency(w.gross)} revenue · {w.rpmAll ? `$${w.rpmAll.toFixed(2)}/mi` : "—"} ·{" "}
                      <span className={w.emptyPct > 20 ? "text-[var(--accent-danger)]" : undefined}>{w.loads.length ? `${w.emptyPct.toFixed(0)}% empty` : "no miles"}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
            {perTruck.length > 5 && <p className="mt-3 text-xs text-ink-500">and {perTruck.length - 5} more, lowest last</p>}
          </section>

          {priced.length > 0 && bestLane && <BentoTile label="Best lane" value={formatCurrency(bestLane.avg)} sub={`${bestLane.key} · avg net`} tone="live" />}
          {priced.length > 0 && worstBrokerEntry && worstBrokerName && (
            <BentoTile label="Lowest-margin broker" value={formatCurrency(worstBrokerEntry.avg)} sub={`${worstBrokerName} · avg net`} tone="danger" />
          )}
          {priced.length > 0 && bestEquip && <BentoTile label="Most profitable equipment" value={formatCurrency(bestEquip.avg)} sub={`${bestEquip.key} · avg net`} />}
          <section className="flex flex-col justify-between rounded-3xl bg-brand-soft p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-brand">
              <Lightbulb className="h-3.5 w-3.5" /> Rate floor
            </p>
            <p className="mt-2 text-sm font-medium text-ink-950">{priced.length ? rateFloorNote : "Not enough delivered loads yet to say."}</p>
          </section>

          <BentoTile label="Net profit, this cycle" value={formatCurrency(netProfitTotal)} />
          <BentoTile label="Avg rate / mile" value={`$${avgRpm.toFixed(2)}`} />
          <BentoTile label="Loads delivered" value={String(delivered.length)} />
          <BentoTile label="Empty-mile rate" value={`${emptyRate.toFixed(1)}%`} sub="Of all miles driven" />
        </div>

        <MoneyCharts loads={loads} trucks={trucks} drivers={driverMap} />
      </div>
    </div>
  );
}

// Numbers stay in ink, like the rest of the page; `tone` only adds a small dot next to the label.
function BentoTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "live" | "danger" }) {
  return (
    <section className="flex min-h-[7.5rem] flex-col justify-between rounded-3xl border border-line bg-white p-4">
      <p className="t-label flex items-center gap-1.5 text-ink-500">
        {tone && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone === "live" ? "bg-[var(--accent-live)]" : "bg-[var(--accent-danger)]"}`} />}
        {label}
      </p>
      <div className="mt-2">
        <p className="text-2xl font-semibold tabular tracking-tight text-ink-950">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-ink-500">{sub}</p>}
      </div>
    </section>
  );
}
