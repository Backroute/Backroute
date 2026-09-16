"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useStore } from "@/lib/store";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

const PLAN_TABS = ["all", "Starter", "Growth", "Fleet"] as const;

export default function CarriersPage() {
  const carriers = useStore((s) => s.carriers);
  const [plan, setPlan] = useState<(typeof PLAN_TABS)[number]>("all");

  const filtered = useMemo(() => {
    const list = plan === "all" ? carriers : carriers.filter((c) => c.plan === plan);
    return [...list].sort((a, b) => b.trucks - a.trucks);
  }, [carriers, plan]);

  return (
    <div>
      <PageHeader title="Carriers" description={`${carriers.length} carrier accounts · ${formatNumber(carriers.reduce((s, c) => s + c.trucks, 0))} trucks tracked`} />

      <div className="px-4 py-6 sm:px-8">
        <Tabs
          tabs={PLAN_TABS.map((p) => ({ key: p, label: p === "all" ? "All plans" : p, count: p === "all" ? carriers.length : carriers.filter((c) => c.plan === p).length }))}
          active={plan}
          onChange={(k) => setPlan(k as (typeof PLAN_TABS)[number])}
        />

        <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-5 py-3 font-medium">Carrier</th>
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium text-right">Trucks</th>
                <th className="px-5 py-3 font-medium text-right">MRR</th>
                <th className="px-5 py-3 font-medium text-right">Take-rate</th>
                <th className="px-5 py-3 font-medium">Health</th>
                <th className="px-5 py-3 font-medium text-right">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-ink-50/60">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-ink-950">{c.name}</p>
                    <p className="text-xs text-ink-400">{c.mc} · {c.city}, {c.state}</p>
                  </td>
                  <td className="px-5 py-3.5"><Badge tone={c.plan === "Fleet" ? "dark" : "neutral"}>{c.plan}</Badge></td>
                  <td className="px-5 py-3.5 text-right tabular">{c.trucks}</td>
                  <td className="px-5 py-3.5 text-right tabular">{formatCurrency(c.mrr)}</td>
                  <td className="px-5 py-3.5 text-right tabular text-[var(--accent-live)]">{formatCurrency(c.takeRateRevenue)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Progress value={c.healthScore} className="w-20" />
                      <span className="text-xs tabular text-ink-500">{c.healthScore}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs text-ink-400">{formatDate(c.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
