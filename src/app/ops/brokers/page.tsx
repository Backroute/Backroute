"use client";

import { PageHeader } from "@/components/shared/portal-shell";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BrokerTrustBadge } from "@/components/shared/broker-trust-badge";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const TIER_TONE = { preferred: "success", standard: "neutral", watch: "warning" } as const;

export default function BrokersPage() {
  const brokers = useStore((s) => s.brokers);
  const sorted = [...brokers].sort((a, b) => b.reliability - a.reliability);

  return (
    <div>
      <PageHeader title="Brokers" description={`${brokers.length} brokers ranked by reliability`} />

      <div className="px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-3 lg:hidden">
          {sorted.map((b) => (
            <div key={b.id} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink-950">{b.company}</p>
                  <p className="text-xs text-ink-400">{b.contact}</p>
                  <BrokerTrustBadge broker={b} className="mt-1" />
                </div>
                <Badge tone={TIER_TONE[b.tier]}>{b.tier}</Badge>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Progress value={b.reliability} className="w-20" />
                <span className="tabular text-xs text-ink-500">Reliability {b.reliability}</span>
              </div>
              <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-xs">
                <span className="text-ink-500">Avg response <span className="font-semibold tabular text-ink-950">{b.avgResponseMins}m</span></span>
                <span className="text-ink-500">Booked <span className="font-semibold tabular text-ink-950">{b.loadsBooked}</span></span>
                <span className="text-ink-500">On-time <span className="font-semibold tabular text-ink-950">{b.onTimePct}%</span></span>
                <span className={cn("ml-auto font-semibold tabular", b.avgRateVariancePct >= 0 ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]")}>
                  {b.avgRateVariancePct >= 0 ? "+" : ""}{b.avgRateVariancePct}% vs market
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-5 py-3 font-medium">Broker</th>
                <th className="px-5 py-3 font-medium">Tier</th>
                <th className="px-5 py-3 font-medium">Reliability</th>
                <th className="px-5 py-3 font-medium text-right">Avg response</th>
                <th className="px-5 py-3 font-medium text-right">Loads booked</th>
                <th className="px-5 py-3 font-medium text-right">On-time</th>
                <th className="px-5 py-3 font-medium text-right">Rate vs. market</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-0 hover:bg-ink-50/60">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-ink-950">{b.company}</p>
                    <p className="text-xs text-ink-400">{b.contact}</p>
                    <BrokerTrustBadge broker={b} className="mt-1" />
                  </td>
                  <td className="px-5 py-3.5"><Badge tone={TIER_TONE[b.tier]}>{b.tier}</Badge></td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Progress value={b.reliability} className="w-20" />
                      <span className="tabular text-xs text-ink-500">{b.reliability}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right tabular text-ink-600">{b.avgResponseMins} min</td>
                  <td className="px-5 py-3.5 text-right tabular text-ink-600">{b.loadsBooked}</td>
                  <td className="px-5 py-3.5 text-right tabular text-ink-600">{b.onTimePct}%</td>
                  <td className="px-5 py-3.5 text-right tabular">
                    <span className={b.avgRateVariancePct >= 0 ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]"}>
                      {b.avgRateVariancePct >= 0 ? "+" : ""}{b.avgRateVariancePct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
