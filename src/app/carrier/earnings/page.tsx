"use client";

import { FirstRunEmpty } from "@/components/shared/empty-next-step";
import { MoneyCharts } from "@/components/shared/money-charts";
import { Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { useCarrierLoads, useCarrierTrucks, useBrokerMap, useDriverMap } from "@/lib/selectors";
import { weekEarnings } from "@/lib/earnings";
import { formatCurrency } from "@/lib/utils";
import { StatusMark } from "@/components/ui/mark";
import { MoneySource, type SourceRow } from "@/components/owner/money-source";
import { ReportCardPanel } from "@/components/owner/report-card";
import type { Load } from "@/lib/types";

export default function EarningsPage() {
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();
  const brokers = useBrokerMap();
  const driverMap = useDriverMap();
  const week = weekEarnings(loads);
  const perTruck = trucks
    .map((t) => ({ truck: t, driver: driverMap.get(t.driverId ?? ""), w: weekEarnings(loads.filter((l) => l.truckId === t.id)) }))
    .sort((a, b) => b.w.net - a.w.net);


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

  // Each number opens the loads behind it.
  const rowOf = (l: Load, value: string, sub?: string): SourceRow => ({
    id: l.id,
    label: `${l.lane.origin} → ${l.lane.destination}`,
    sub: sub ?? `${l.referenceNumber} · ${brokers.get(l.brokerId)?.company ?? "Broker"}`,
    value,
    href: `/carrier/loads/${l.id}`,
  });
  const netRows = week.loads.map((l) => rowOf(l, formatCurrency(l.netProfit ?? 0), `${l.referenceNumber} · ${formatCurrency(l.bookedRate ?? 0)} in`));
  const rpmRows = week.loads.map((l) => rowOf(l, `${l.lane.miles + l.deadheadMiles} mi`, `${formatCurrency(l.bookedRate ?? 0)} · ${l.lane.miles} loaded + ${l.deadheadMiles} empty`));
  const emptyRows = week.loads.filter((l) => l.deadheadMiles > 0).map((l) => rowOf(l, `${l.deadheadMiles} mi`, `${l.referenceNumber} · empty to pickup`));
  const postedRows = week.loads
    .filter((l) => (l.bookedRate ?? 0) > l.listedRate)
    .map((l) => rowOf(l, `+${formatCurrency((l.bookedRate ?? 0) - l.listedRate)}`, `Posted ${formatCurrency(l.listedRate)} · booked ${formatCurrency(l.bookedRate ?? 0)}`));
  const detentionRows = week.loads.flatMap((l) =>
    (l.accessorials ?? []).map((a, i) => ({ ...rowOf(l, formatCurrency(a.amount), `${a.type === "detention" ? "Detention" : a.type} · ${a.status}`), id: `${l.id}-${i}` })),
  );

  return (
    <div>
      <PageHeader title="Earnings" />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        {!loads.some((l) => l.stage === "delivered" || l.imported) && (
          <FirstRunEmpty
            title="Nothing earned yet"
            body="Each load shows here the day it delivers: what it paid, less fuel, tolls and empty miles. Bring in last year's loads to see your lanes and brokers from day one."
            action="Bring your history"
            href="/carrier/settings?tab=general#set-history"
          />
        )}
        {/* Bento: the week's number is the big tile, everything that explains it sits around it in smaller ones. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneySource
            title="This week's net profit"
            how="Each load this week (Monday to Sunday, by the day it delivers or picks up): what it paid, less fuel, tolls, empty miles and fees."
            rows={netRows}
            total={formatCurrency(week.net)}
            className="col-span-2 lg:row-span-2"
          >
          <section className="theme-ink flex h-full flex-col justify-between rounded-3xl bg-ink-950 p-5 text-white sm:p-6" aria-labelledby="week-title">
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
                <TrendingUp className="h-4 w-4" /> Backroute earned you {formatCurrency(week.overMarket)} more than market
              </p>
            )}
            <p className="mt-4 text-xs text-white/45">Tap for the loads behind it</p>
          </section>
          </MoneySource>
          <MoneySource title="Revenue per mile" how={`Revenue ${formatCurrency(week.gross)} ÷ every mile driven (${week.loadedMiles + week.emptyMiles} loaded and empty).`} rows={rpmRows} total={`$${week.rpmAll.toFixed(2)}/mi`}>
            <BentoTile label="Revenue / mile, all miles" value={`$${week.rpmAll.toFixed(2)}`} />
          </MoneySource>
          <MoneySource title="Empty miles" how={`${week.emptyMiles} empty miles out of ${week.loadedMiles + week.emptyMiles} driven this week.`} rows={emptyRows} total={`${week.emptyPct.toFixed(0)}%`}>
            <BentoTile label="Empty miles" value={`${week.emptyPct.toFixed(0)}%`} tone={week.emptyPct > 20 ? "danger" : undefined} />
          </MoneySource>
          <MoneySource title="Above posted rates" how="What each load booked for over what the broker first posted." rows={postedRows} total={`+${formatCurrency(week.overPosted)}`}>
            <BentoTile label="Above posted rates" value={`+${formatCurrency(week.overPosted)}`} tone={week.overPosted > 0 ? "live" : undefined} />
          </MoneySource>
          <MoneySource title="Detention and extras" how="Detention, layover and other extras billed to brokers on this week's loads." rows={detentionRows} total={formatCurrency(week.extras)}>
            <BentoTile label="Detention billed for you" value={week.extras ? `+${formatCurrency(week.extras)}` : "$0"} />
          </MoneySource>

          <section aria-labelledby="trucks-title" className="col-span-2 rounded-3xl border border-line bg-white p-5 lg:row-span-2">
            <h3 id="trucks-title" className="t-section text-ink-950">
              Profit by truck
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">This week. Backroute plans each truck&apos;s next loads to lift the weakest ones.</p>
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

        </div>

        <MoneyCharts loads={loads} trucks={trucks} drivers={driverMap} />
        <ReportCardPanel />
      </div>
    </div>
  );
}

// Numbers stay in ink, like the rest of the page; `tone` only adds a small mark next to the label.
function BentoTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "live" | "danger" }) {
  return (
    <section className="flex h-full min-h-[7.5rem] flex-col justify-between rounded-3xl border border-line bg-white p-4">
      <p className="t-label flex items-center gap-1.5 text-ink-500">
        {tone && <StatusMark kind={tone === "live" ? "done" : "needs_you"} />}
        {label}
      </p>
      <div className="mt-2">
        <p className="text-2xl font-semibold tabular tracking-tight text-ink-950">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-ink-500">{sub}</p>}
      </div>
    </section>
  );
}
