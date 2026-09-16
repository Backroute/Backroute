"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shared/portal-shell";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { LiveDot } from "@/components/shared/live-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { LOAD_STAGE_ORDER, LOAD_STAGE_LABEL } from "@/lib/types";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useBrokerMap } from "@/lib/selectors";
import { formatCurrency } from "@/lib/utils";

export default function OpsLoadsPage() {
  const loads = useStore((s) => s.loads);
  const carrier = usePrimaryCarrier();
  const brokers = useBrokerMap();

  const sorted = [...loads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const counts = Object.fromEntries(LOAD_STAGE_ORDER.map((stage) => [stage, loads.filter((l) => l.stage === stage).length]));

  return (
    <div>
      <PageHeader title="Loads" description={`${loads.length} loads · Titan Freight LLC`} right={<LiveDot />} />

      <div className="px-4 py-6 sm:px-8">
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
          {LOAD_STAGE_ORDER.map((stage) => (
            <div key={stage} className="rounded-xl border border-line bg-white p-3 text-center">
              <p className="font-display text-xl tabular text-ink-950">{counts[stage]}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-ink-500">{LOAD_STAGE_LABEL[stage]}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-5 py-3 font-medium">Lane</th>
                <th className="px-5 py-3 font-medium">Carrier</th>
                <th className="px-5 py-3 font-medium">Broker</th>
                <th className="px-5 py-3 font-medium">Score</th>
                <th className="px-5 py-3 font-medium">Stage</th>
                <th className="px-5 py-3 font-medium text-right">Total offer</th>
                <th className="px-5 py-3 font-medium text-right">Est. net</th>
                <th className="px-5 py-3 font-medium text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((load) => (
                <tr key={load.id} className="border-b border-line last:border-0 hover:bg-ink-50/60">
                  <td className="px-5 py-3.5">
                    <Link href={`/ops/loads/${load.id}`} className="block">
                      <p className="font-medium text-ink-950">{load.lane.origin} <span className="text-ink-300">→</span> {load.lane.destination}</p>
                      <p className="text-xs text-ink-400">{load.referenceNumber}</p>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-ink-600">{carrier.name}</td>
                  <td className="px-5 py-3.5 text-ink-600">{brokers.get(load.brokerId)?.company ?? "—"}</td>
                  <td className="px-5 py-3.5"><LoadScoreBadge score={load.score} size="sm" /></td>
                  <td className="px-5 py-3.5"><LoadStagePill stage={load.stage} /></td>
                  <td className="px-5 py-3.5 text-right tabular">{formatCurrency(load.bookedRate ?? load.targetRate)}</td>
                  <td className="px-5 py-3.5 text-right tabular font-medium text-ink-950">{load.netProfit !== null ? formatCurrency(load.netProfit) : "—"}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-ink-400"><TimeAgo iso={load.updatedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
