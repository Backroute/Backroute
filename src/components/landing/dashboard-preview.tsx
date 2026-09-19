"use client";

import { LayoutGrid, MessageSquareText, Settings, Truck, BarChart3 } from "lucide-react";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { LiveDot } from "@/components/shared/live-dot";
import { useCarrierLoads, usePrimaryCarrier, useBrokerMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn, formatCurrency } from "@/lib/utils";

const NAV_ICONS = [LayoutGrid, Truck, MessageSquareText, BarChart3, Settings];

export function DashboardPreview() {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const activity = useStore((s) => s.activity);

  const rows = loads
    .filter((l) => l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "cancelled" && l.stage !== "offered")
    .slice(0, 3);
  const netProfit = loads.reduce((s, l) => s + (l.netProfit ?? 0), 0);
  const latest = activity[0];

  return (
    <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.45)]">
      {/* chrome bar */}
      <div className="flex items-center gap-3 border-b border-line bg-ink-50/70 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink-200" />
        </div>
        <div className="flex-1 rounded-md bg-white px-3 py-1 text-center text-[11px] text-ink-400">
          app.backroute.com/carrier
        </div>
      </div>

      <div className="flex">
        {/* mini sidebar */}
        <div className="hidden w-12 shrink-0 flex-col items-center gap-4 border-r border-line bg-ink-50/40 py-4 sm:flex">
          {NAV_ICONS.map((Icon, i) => (
            <span
              key={i}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                i === 0 ? "bg-ink-950 text-white" : "text-ink-300",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
          ))}
        </div>

        {/* main */}
        <div className="flex-1 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-ink-950">{carrier.name}</p>
              <p className="text-[11px] text-ink-400">{carrier.trucks} trucks · {carrier.plan} plan</p>
            </div>
            <LiveDot label="Live" />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniStat label="Active loads" value={String(rows.length + 4)} />
            <MiniStat label="Net profit" value={formatCurrency(netProfit)} />
            <MiniStat label="Saved vs. human" value="$961/mo" tone />
          </div>

          <div className="mt-4 flex flex-col divide-y divide-line rounded-xl border border-line">
            {rows.map((load) => (
              <div key={load.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-ink-900">
                    {load.lane.origin} <span className="text-ink-300">&rarr;</span> {load.lane.destination}
                  </p>
                  <p className="truncate text-[10px] text-ink-400">{brokers.get(load.brokerId)?.company}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <LoadScoreBadge score={load.score} size="sm" />
                  <LoadStagePill stage={load.stage} className="!text-[9px] !px-1.5 !py-0.5" />
                </div>
              </div>
            ))}
          </div>

          {latest && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-ink-50/70 px-3 py-2 text-[11px] text-ink-600">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-live)]" />
              <span className="truncate">{latest.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="rounded-lg bg-ink-50/70 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cn("mt-0.5 text-[13px] font-bold tabular", tone ? "text-[var(--accent-live)]" : "text-ink-950")}>{value}</p>
    </div>
  );
}
