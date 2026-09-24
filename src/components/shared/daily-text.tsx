"use client";

import { MessageSquare } from "lucide-react";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { usePrimaryCarrier, useCarrierLoads } from "@/lib/selectors";
import { formatCurrency } from "@/lib/utils";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The owner's end-of-day text: what got done, what it made, and the one thing that needs them — for owners who'll
 *  never open a dashboard but read every text. */
export function useDailyText(): string | null {
  const now = useNow();
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useStore((s) => s.trucks);
  const drivers = useStore((s) => s.drivers);
  const escalations = useStore((s) => s.escalations);
  const timeOff = useStore((s) => s.timeOffRequests);
  const expenses = useStore((s) => s.expenses);
  if (now === null) return null;

  const today = new Date(now).toDateString();
  const delivered = loads.filter((l) => l.stage === "delivered" && new Date(l.updatedAt).toDateString() === today);
  const profit = delivered.reduce((s, l) => s + (l.netProfit ?? 0), 0);
  const rolling = trucks.filter((t) => loads.some((l) => l.id === t.currentLoadId && (l.stage === "in_transit" || l.stage === "dispatched"))).length;
  const name = (id: string) => drivers.find((d) => d.id === id)?.name.split(" ")[0] ?? "a driver";
  const asks = [
    ...escalations.filter((e) => e.carrierId === carrier.id && e.status === "open").map((e) => e.reason.split(". ")[0]),
    ...expenses.filter((e) => e.status === "pending").map((e) => `pay back ${name(e.driverId)}'s ${formatCurrency(e.amount)} ${e.category}`),
    ...timeOff.filter((r) => r.carrierId === carrier.id && r.status === "pending").map((r) => `answer ${name(r.driverId)}'s time-off request`),
  ];
  const d = new Date(now);
  const parts = [
    `${carrier.name}, ${WEEKDAY[d.getDay()]}: ${delivered.length} load${delivered.length === 1 ? "" : "s"} delivered, ${formatCurrency(profit)} profit.`,
    rolling ? `${rolling} truck${rolling === 1 ? "" : "s"} still rolling tonight.` : "All trucks parked for the night.",
    asks.length ? `${asks.length} thing${asks.length === 1 ? " needs" : "s need"} you, first: ${asks[0].charAt(0).toLowerCase()}${asks[0].slice(1)}.` : "Nothing needs you.",
    "Details: backroute.app/today",
  ];
  return parts.join(" ");
}

export function DailyTextPreview() {
  const text = useDailyText();
  const phone = "(214) 555-0100";
  if (!text) return null;
  return (
    <div className="rounded-2xl bg-ink-50 p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400">
        <MessageSquare className="h-3.5 w-3.5" /> Text to {phone} at 6 PM
      </p>
      <p className="mt-2 max-w-md rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink-800 shadow-sm">{text}</p>
    </div>
  );
}
