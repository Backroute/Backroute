"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LiveDot } from "@/components/shared/live-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { useCarrierLoads, useBrokerMap, useTruckMap, useDriverMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn, formatCurrency } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv-export";
import type { Broker, Load, LoadStage, Truck } from "@/lib/types";

function exportLoads(loads: Load[], brokers: Map<string, Broker>, trucks: Map<string, Truck>) {
  downloadCsv(
    `loads-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Reference", "Origin", "Destination", "Broker", "Score", "Stage", "Truck", "Equipment", "Miles", "Rate", "Net Profit", "Updated"],
    loads.map((l) => [
      l.referenceNumber,
      `${l.lane.origin}, ${l.lane.originState}`,
      `${l.lane.destination}, ${l.lane.destState}`,
      brokers.get(l.brokerId)?.company ?? "",
      l.score,
      l.stage,
      (l.truckId ? trucks.get(l.truckId)?.unitNumber : "") ?? "",
      l.equipmentType,
      l.lane.miles,
      l.bookedRate ?? l.targetRate,
      l.netProfit ?? "",
      l.updatedAt,
    ]),
  );
}

const GROUPS: { key: string; label: string; stages: LoadStage[] | "all" }[] = [
  { key: "active", label: "Active", stages: ["sourced", "scoring", "offered", "negotiating", "rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery"] },
  { key: "offers", label: "Offers", stages: ["offered"] },
  { key: "negotiating", label: "Negotiating", stages: ["negotiating"] },
  { key: "booked", label: "Booked", stages: ["rate_confirmed", "booked"] },
  { key: "transit", label: "In Transit", stages: ["dispatched", "at_pickup", "in_transit", "at_delivery"] },
  { key: "delivered", label: "Delivered", stages: ["delivered"] },
  { key: "all", label: "All", stages: "all" },
];

export default function CarrierLoadsPage() {
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const trucks = useTruckMap();
  const drivers = useDriverMap();
  const selectLoadOffer = useStore((s) => s.actions.selectLoadOffer);
  const requestOfferDetail = useStore((s) => s.actions.requestOfferDetail);
  const resolveOfferDetail = useStore((s) => s.actions.resolveOfferDetail);
  const [group, setGroup] = useState("active");

  const activeGroup = GROUPS.find((g) => g.key === group)!;
  const filtered = useMemo(() => {
    const list = activeGroup.stages === "all" ? loads : loads.filter((l) => activeGroup.stages.includes(l.stage));
    return [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [loads, activeGroup]);

  const counts = Object.fromEntries(
    GROUPS.map((g) => [g.key, g.stages === "all" ? loads.length : loads.filter((l) => g.stages.includes(l.stage)).length]),
  );

  const offerGroups = useMemo(() => {
    if (group !== "offers") return [];
    const map = new Map<string, typeof filtered>();
    for (const load of filtered) {
      if (!load.offerGroupId) continue;
      map.set(load.offerGroupId, [...(map.get(load.offerGroupId) ?? []), load]);
    }
    return Array.from(map.entries());
  }, [filtered, group]);

  return (
    <div>
      <PageHeader
        title="Loads"
        description={`${loads.length} loads`}
        right={
          <div className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => exportLoads(filtered, brokers, trucks)}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <LiveDot />
          </div>
        }
      />

      <div className="px-4 py-6 sm:px-8">
        <Tabs tabs={GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts[g.key] }))} active={group} onChange={setGroup} />

        {group === "offers" ? (
          <div className="mt-5">
            {offerGroups.length === 0 ? (
              <p className="py-12 text-center text-sm text-ink-400">No pending load choices right now — the AI will surface options as trucks free up.</p>
            ) : (
              <NextLoadOffers
                offerGroups={offerGroups}
                brokers={brokers}
                trucks={trucks}
                drivers={drivers}
                onSelect={(groupId, loadId) => selectLoadOffer(groupId, loadId, "carrier")}
                onAsk={(loadId, text) => requestOfferDetail(loadId, text)}
                onAskResolve={(loadId, draft) => resolveOfferDetail(loadId, draft)}
              />
            )}
          </div>
        ) : (
          <>
            {/* Mobile: cards — the desktop table's 8 columns don't fit a phone screen; a wide table just
             *  forces horizontal scrolling past the numbers that matter most. */}
            <div className="mt-5 flex flex-col gap-3 lg:hidden">
              {filtered.map((load) => {
                const broker = brokers.get(load.brokerId);
                const truck = load.truckId ? trucks.get(load.truckId) : undefined;
                return (
                  <Link key={load.id} href={`/carrier/loads/${load.id}`} className="block rounded-2xl border border-line bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-950">
                          {load.lane.origin}, {load.lane.originState} <span className="text-ink-300">→</span> {load.lane.destination}, {load.lane.destState}
                          {load.stops && load.stops.length > 0 && <Badge tone="info" className="ml-1.5 align-middle">+{load.stops.length} stop{load.stops.length === 1 ? "" : "s"}</Badge>}
                        </p>
                        <p className="text-xs text-ink-400">{load.referenceNumber} · {broker?.company ?? "—"}</p>
                      </div>
                      <LoadScoreBadge score={load.score} size="sm" />
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <LoadStagePill stage={load.stage} />
                      {truck && <span className="text-xs text-ink-400">{truck.unitNumber}</span>}
                      <span className="ml-auto text-xs text-ink-400"><TimeAgo iso={load.updatedAt} /></span>
                    </div>
                    <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-xs">
                      <span className="text-ink-500">
                        Rate <span className="font-semibold tabular text-ink-950">
                          {load.bookedRate ? formatCurrency(load.bookedRate) : `Target ${formatCurrency(load.targetRate)}`}
                        </span>
                      </span>
                      <span className="text-ink-500">
                        Net profit{" "}
                        <span className={cn("font-semibold tabular", load.netProfit ? (load.netProfit > 0 ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]") : "text-ink-300")}>
                          {load.netProfit ? formatCurrency(load.netProfit) : "—"}
                        </span>
                      </span>
                    </div>
                  </Link>
                );
              })}
              {filtered.length === 0 && <p className="py-12 text-center text-sm text-ink-400">No loads in this view.</p>}
            </div>

            {/* Desktop: dense table */}
            <div className="mt-5 hidden overflow-x-auto rounded-2xl border border-line bg-white lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="px-5 py-3 font-medium">Lane</th>
                  <th className="px-5 py-3 font-medium">Broker</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                  <th className="px-5 py-3 font-medium">Stage</th>
                  <th className="px-5 py-3 font-medium">Truck</th>
                  <th className="px-5 py-3 font-medium text-right">Rate</th>
                  <th className="px-5 py-3 font-medium text-right">Net profit</th>
                  <th className="px-5 py-3 font-medium text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((load) => {
                  const broker = brokers.get(load.brokerId);
                  const truck = load.truckId ? trucks.get(load.truckId) : undefined;
                  return (
                    <tr key={load.id} className="border-b border-line last:border-0 hover:bg-ink-50/60">
                      <td className="px-5 py-3.5">
                        <Link href={`/carrier/loads/${load.id}`} className="block">
                          <p className="font-medium text-ink-950">
                            {load.lane.origin}, {load.lane.originState} <span className="text-ink-300">→</span> {load.lane.destination}, {load.lane.destState}
                            {load.stops && load.stops.length > 0 && <Badge tone="info" className="ml-1.5 align-middle">+{load.stops.length} stop{load.stops.length === 1 ? "" : "s"}</Badge>}
                          </p>
                          <p className="text-xs text-ink-400">{load.referenceNumber} · {load.equipmentType} · {load.lane.miles} mi</p>
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-ink-600">{broker?.company ?? "—"}</td>
                      <td className="px-5 py-3.5"><LoadScoreBadge score={load.score} size="sm" /></td>
                      <td className="px-5 py-3.5"><LoadStagePill stage={load.stage} /></td>
                      <td className="px-5 py-3.5 text-ink-600">{truck?.unitNumber ?? "—"}</td>
                      <td className="px-5 py-3.5 text-right tabular text-ink-950">
                        {load.bookedRate ? formatCurrency(load.bookedRate) : <span className="text-ink-400">Target {formatCurrency(load.targetRate)}</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular">
                        {load.netProfit ? <span className={load.netProfit > 0 ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]"}>{formatCurrency(load.netProfit)}</span> : <span className="text-ink-300">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs text-ink-400"><TimeAgo iso={load.updatedAt} /></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-ink-400">No loads in this view.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
