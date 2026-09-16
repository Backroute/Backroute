"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/portal-shell";
import { Tabs } from "@/components/ui/tabs";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LiveDot } from "@/components/shared/live-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { useCarrierLoads, useBrokerMap, useTruckMap } from "@/lib/selectors";
import { formatCurrency } from "@/lib/utils";
import type { LoadStage } from "@/lib/types";

const GROUPS: { key: string; label: string; stages: LoadStage[] | "all" }[] = [
  { key: "active", label: "Active", stages: ["sourced", "scoring", "negotiating", "rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery"] },
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
  const [group, setGroup] = useState("active");

  const activeGroup = GROUPS.find((g) => g.key === group)!;
  const filtered = useMemo(() => {
    const list = activeGroup.stages === "all" ? loads : loads.filter((l) => activeGroup.stages.includes(l.stage));
    return [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [loads, activeGroup]);

  const counts = Object.fromEntries(
    GROUPS.map((g) => [g.key, g.stages === "all" ? loads.length : loads.filter((l) => g.stages.includes(l.stage)).length]),
  );

  return (
    <div>
      <PageHeader title="Loads" description="Every load the AI has sourced, negotiated, or booked for your fleet." right={<LiveDot />} />

      <div className="px-8 py-6">
        <Tabs tabs={GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts[g.key] }))} active={group} onChange={setGroup} />

        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-5 py-3 font-medium">Lane</th>
                <th className="px-5 py-3 font-medium">Broker</th>
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
                        <p className="font-medium text-ink-950">{load.lane.origin}, {load.lane.originState} <span className="text-ink-300">→</span> {load.lane.destination}, {load.lane.destState}</p>
                        <p className="text-xs text-ink-400">{load.referenceNumber} · {load.equipmentType} · {load.lane.miles} mi</p>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-ink-600">{broker?.company ?? "—"}</td>
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
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-400">No loads in this view.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
