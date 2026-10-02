"use client";

import Link from "next/link";
import { Wallet } from "lucide-react";
import { useBrokerMap, useCarrierLoads } from "@/lib/selectors";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import type { Load } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const DAY = 86400_000;

/** Monday 00:00 of this week, local time. */
function weekStart(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const deliveredAt = (l: Load) => Date.parse(l.tripChecklist?.unloadedAt ?? l.deliveryAt ?? l.updatedAt);
const billed = (l: Load) => l.invoice?.amount ?? l.bookedRate ?? 0;
const kept = (l: Load) => l.netProfit ?? billed(l) - (l.fuelCost ?? 0) - (l.tollCost ?? 0) - (l.deadheadCost ?? 0) - (l.commission ?? 0);

/**
 * The week's money in plain numbers: what the delivered loads bill, what they cost, what's kept, and the invoices
 * that are late, with what the AI already did about each.
 */
export function MoneyCard() {
  const real = useStore((s) => s.session.mode !== "demo");
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const now = useNow();
  if (!real || now === null) return null;
  const from = weekStart(new Date(now));
  const week = loads.filter((l) => !l.imported && l.stage === "delivered" && deliveredAt(l) >= from);
  const into = week.reduce((s, l) => s + billed(l), 0);
  const keep = week.reduce((s, l) => s + kept(l), 0);
  const late = loads
    .filter((l) => l.invoice?.sentAt && !l.invoice.paidAt)
    .map((l) => {
      const days = Math.floor((now - Date.parse(l.invoice!.sentAt!)) / DAY);
      const terms = brokers.get(l.brokerId)?.avgDaysToPay ?? 30;
      return { l, days, terms, broker: brokers.get(l.brokerId)?.company ?? "A broker", reminders: l.invoice!.remindedAt ?? [] };
    })
    .filter((x) => x.days > x.terms)
    .sort((a, b) => b.days - a.days);

  return (
    <section aria-labelledby="money-title" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="money-title" className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          <Wallet className="h-4 w-4" /> Money this week
        </h2>
        <Link href="/carrier/earnings" className="text-xs font-medium text-ink-700 underline-offset-2 hover:underline">
          Details
        </Link>
      </div>
      {week.length ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-800">
          <span className="font-semibold tabular text-ink-950">{formatCurrency(into)}</span> in from {week.length} load{week.length === 1 ? "" : "s"},{" "}
          <span className="font-semibold tabular text-ink-950">{formatCurrency(Math.max(0, into - keep))}</span> out (fuel, tolls, empty miles, fees),{" "}
          <span className="font-semibold tabular text-ink-950">{formatCurrency(keep)}</span> kept.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-700">No loads delivered yet this week. The numbers show here as they come in.</p>
      )}
      {late.length > 0 ? (
        <div className="mt-3 rounded-xl bg-warn-soft px-3 py-2.5">
          <p className="text-sm font-medium text-ink-950">
            {late.length} invoice{late.length === 1 ? " is" : "s are"} late
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-ink-800">
            {late.slice(0, 4).map(({ l, days, broker, reminders }) => (
              <li key={l.id}>
                <Link href={`/carrier/loads/${l.id}`} className="underline-offset-2 hover:underline">
                  {broker}, {formatCurrency(billed(l))}, {days} days
                </Link>
                {" · "}
                {reminders.length
                  ? `the AI sent ${reminders.length} reminder${reminders.length === 1 ? "" : "s"}, last on ${new Date(reminders.at(-1)!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : "the AI sends a reminder 3 days past terms"}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-600">No invoices are late.</p>
      )}
    </section>
  );
}
