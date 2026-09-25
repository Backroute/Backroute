"use client";

import Link from "next/link";
import { ArrowUpRight, Briefcase, Check, LifeBuoy, X } from "lucide-react";
import { AutopilotControl } from "@/components/shared/autopilot-control";
import { DraftApproval } from "@/components/shared/draft-approval";
import { RuleSuggestion } from "@/components/cloud/owner-rules";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { weekEarnings } from "@/lib/earnings";
import { paymentStatus } from "@/lib/payments";
import { cn, formatCurrency } from "@/lib/utils";
import type { Driver, Load, Truck } from "@/lib/types";

/**
 * Owner-operator mode: one truck, and the owner drives it. There's no office to wait on, so the driver app is the
 * whole business — the approvals a fleet owner would get on the dashboard, the profit instead of driver pay, and
 * the business settings. Everything else the AI still does on its own.
 */

/** The approvals that would go to a fleet owner, for this owner's own truck: repair quotes, broker issues, call-backs. */
export function OwnerNeedsYou({ driver, truck }: { driver: Driver; truck: Truck | undefined }) {
  const { t } = useDriverUi();
  const loads = useStore((s) => s.loads);
  const incidents = useStore((s) => s.incidents);
  const escalations = useStore((s) => s.escalations);
  const resolveEscalation = useStore((s) => s.actions.resolveEscalation);
  const truckLoads = new Set(loads.filter((l) => l.truckId === truck?.id).map((l) => l.id));
  const myIncidents = new Set(incidents.filter((i) => i.driverId === driver.id).map((i) => i.id));
  const first = driver.name.split(" ")[0];
  const mine = escalations.filter(
    (e) =>
      e.status !== "resolved" &&
      (truckLoads.has(e.loadId) || (e.incidentId && myIncidents.has(e.incidentId)) || (!e.loadId && e.reason.startsWith(first)) || (!!e.draft && !e.loadId)),
  );
  if (!mine.length) return null;

  return (
    <section aria-labelledby="owner-needs-you" className="rounded-3xl border border-[var(--accent-warn)]/40 bg-amber-50/60 p-4">
      <h2 id="owner-needs-you" className="text-sm font-semibold text-ink-950">
        {t.needsYou} · {mine.length}
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {mine.map((e) => (
          <li key={e.id} className="rounded-2xl bg-white p-3">
            {/* The reasons come from the AI's English log in the demo. */}
            <p lang="en" className="text-sm leading-snug text-ink-800">
              {e.reason}
            </p>
            {e.suggestRule ? (
              <RuleSuggestion escalation={e} />
            ) : e.draft ? (
              <DraftApproval escalation={e} />
            ) : e.status === "with_support" ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <LifeBuoy className="h-3.5 w-3.5 animate-pulse" /> {t.supportOnIt}
              </p>
            ) : (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => resolveEscalation(e.id, true, "carrier")}
                  className="flex items-center justify-center gap-1.5 rounded-full bg-ink-950 py-2 text-xs font-semibold text-white"
                >
                  <Check className="h-3.5 w-3.5" /> {t.approve}
                </button>
                <button
                  type="button"
                  onClick={() => resolveEscalation(e.id, false, "carrier")}
                  className="flex items-center justify-center gap-1.5 rounded-full border border-line py-2 text-xs font-semibold text-ink-700"
                >
                  <X className="h-3.5 w-3.5" /> {t.decline}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Owner-operator profit this week: what the truck made after the costs the AI can see. */
export function useOwnerProfit(truck: Truck | undefined) {
  const loads = useStore((s) => s.loads);
  return weekEarnings(loads.filter((l) => l.truckId === truck?.id));
}

const FLOORS = [
  { pct: 100, label: "Market rate or better" },
  { pct: 96, label: "A little under market" },
  { pct: 90, label: "Anything that makes money" },
];

/** On Profile: the switch into owner-operator mode, and — once on — the business settings a fleet owner keeps on
 *  the dashboard. The dashboard still works too, for anyone who wants the bigger screen. */
export function BusinessCard() {
  const { t, solo } = useDriverUi();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  return (
    <section id="business" className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
          <Briefcase className="h-3.5 w-3.5" /> {t.yourBusiness}
        </p>
        <Switch checked={solo} onChange={(on) => updateSettings({ ownerOperator: on })} label={t.ownTruck} />
      </div>
      <p className="mt-1 text-sm font-medium text-ink-950">{t.ownTruck}</p>
      <p className="mt-0.5 text-xs text-ink-500">{t.ownTruckNote}</p>
      {solo && (
        <div lang="en" className="mt-4 flex flex-col gap-4">
          <AutopilotControl />
          <div>
            <p className="text-xs font-medium text-ink-800">Lowest rate you&apos;ll take</p>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {FLOORS.map((f) => (
                <button
                  key={f.pct}
                  type="button"
                  aria-pressed={settings.rateFloorPct === f.pct}
                  onClick={() => updateSettings({ rateFloorPct: f.pct })}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-left text-xs font-medium",
                    settings.rateFloorPct === f.pct ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <Link href="/carrier" className="flex items-center justify-between rounded-2xl bg-ink-50 px-3.5 py-2.5 text-xs text-ink-700">
            Brokers, payments and paperwork on a bigger screen <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}

/** The Earnings tab for an owner-operator: the truck's profit and where each invoice's money is. */
export function OwnerMoney({ truck }: { truck: Truck | undefined }) {
  const now = useNow();
  const week = useOwnerProfit(truck);
  const loads = useStore((s) => s.loads);
  const brokers = useStore((s) => s.brokers);
  const factoringOn = useStore((s) => s.settings.enabledAddons.includes("factoring-ai"));
  const costs = week.loads.reduce(
    (c, l) => ({ fuel: c.fuel + l.fuelCost, tolls: c.tolls + l.tollCost, empty: c.empty + l.deadheadCost, fee: c.fee + l.commission }),
    { fuel: 0, tolls: 0, empty: 0, fee: 0 },
  );
  const delivered = loads
    .filter((l): l is Load => l.truckId === truck?.id && l.stage === "delivered")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);

  return (
    <div lang="en" className="flex flex-col gap-5">
      <section className="rounded-3xl bg-ink-950 p-5 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Your profit this week</p>
        <p className="mt-1 text-4xl font-semibold tabular tracking-tight">{formatCurrency(week.net)}</p>
        <p className="mt-1 text-xs text-white/55">
          {formatCurrency(week.gross)} in, on {week.loads.length} load{week.loads.length === 1 ? "" : "s"}
        </p>
        <ul className="mt-4 flex flex-col gap-1.5 text-xs text-white/70">
          <Cost label="Fuel" value={costs.fuel} />
          <Cost label="Tolls" value={costs.tolls} />
          <Cost label="Empty miles" value={costs.empty} />
          <Cost label="Backroute fee" value={costs.fee} />
        </ul>
        <p className="mt-3 text-[11px] text-white/40">Before your truck payment, insurance and maintenance, which the AI doesn&apos;t see yet.</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-950">Getting paid</h2>
        {now === null || !delivered.length ? (
          <p className="rounded-2xl border border-line px-4 py-5 text-center text-xs text-ink-500">No delivered loads yet this cycle.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {delivered.map((l) => {
              const p = paymentStatus(l, brokers.find((b) => b.id === l.brokerId), factoringOn, now);
              return (
                <li key={l.id}>
                  <Link href={`/driver/loads/${l.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-950">
                        {l.lane.origin} → {l.lane.destination}
                      </p>
                      <p className={cn("text-xs", p.state === "overdue" ? "text-[var(--accent-danger)]" : "text-ink-500")}>{p.headline}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular text-ink-950">{formatCurrency(p.payout)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Cost({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <span className="tabular">−{formatCurrency(value)}</span>
    </li>
  );
}
