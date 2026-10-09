"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AttentionCard } from "@/components/ui/attention";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads } from "@/lib/selectors";
import type { ActivityEvent, Load } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

/** Gone this long or more, and Home opens with what happened meanwhile. */
const AWAY_MS = 3 * 3600_000;
const key = (carrierId: string) => `backroute.lastSeen.${carrierId}`;

function readSeen(carrierId: string): number | null {
  try {
    const v = Number(localStorage.getItem(key(carrierId)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeSeen(carrierId: string, at: number) {
  try {
    localStorage.setItem(key(carrierId), String(at));
  } catch {}
}

const deliveredAt = (l: Load) => Date.parse(l.tripChecklist?.unloadedAt ?? l.deliveryAt ?? l.updatedAt);

function when(since: number, now: number): string {
  const d = new Date(since);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(since).setHours(0, 0, 0, 0)) / 86400_000);
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "long" })} at ${time}`;
}

/**
 * "Since you were last here": one card with what the AI did while the owner was away (loads booked, delivered, money
 * in) and how many things wait for them. Shown once per return, after three hours or more away.
 */
export function SinceLastVisit({ needsYou }: { needsYou: number }) {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const activity = useStore((s) => s.activity);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const t = Date.now();
    const seen = readSeen(carrier.id);
    // The first visit sets the mark; there's nothing to catch up on yet.
    const away = seen !== null && t - seen >= AWAY_MS;
    const id = setTimeout(() => {
      setNow(t);
      setSince(away ? seen : null);
    }, 0);
    writeSeen(carrier.id, t);
    // Keeps the mark fresh while the owner is here, so a short break doesn't count as away.
    const tick = setInterval(() => writeSeen(carrier.id, Date.now()), 60_000);
    return () => {
      clearTimeout(id);
      clearInterval(tick);
    };
  }, [carrier.id]);

  if (since === null || now === null || closed) return null;
  const mine = (e: ActivityEvent) => e.carrierId === carrier.id && Date.parse(e.timestamp) > since;
  const bookedIds = new Set(activity.filter((e) => mine(e) && (e.type === "booked" || e.type === "rate_confirmed") && e.loadId).map((e) => e.loadId!));
  const booked = loads.filter((l) => bookedIds.has(l.id));
  const bookedValue = booked.reduce((s, l) => s + (l.bookedRate ?? l.targetRate ?? 0), 0);
  const delivered = loads.filter((l) => l.stage === "delivered" && deliveredAt(l) > since);
  const paid = loads.filter((l) => l.invoice?.paidAt && Date.parse(l.invoice.paidAt) > since);
  const paidValue = paid.reduce((s, l) => s + (l.invoice?.paidAmount ?? l.invoice?.amount ?? 0), 0);
  const calls = activity.filter((e) => mine(e) && e.type === "call_completed").length;

  const parts = [
    booked.length ? `${booked.length} load${booked.length === 1 ? "" : "s"} booked${bookedValue ? ` (${formatCurrency(bookedValue)})` : ""}` : null,
    delivered.length ? `${delivered.length} delivered` : null,
    paid.length ? `${formatCurrency(paidValue)} paid` : null,
    calls ? `${calls} call${calls === 1 ? "" : "s"} handled` : null,
  ].filter(Boolean) as string[];

  return (
    <AttentionCard tone={needsYou ? "waiting" : "done"} aria-label="While you were away">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="t-label text-ink-500">Since {when(since, now)}</p>
          <p className="mt-1 text-base font-semibold text-ink-950">
            {parts.length ? `Backroute: ${parts.join(" · ")}.` : "Quiet while you were away. Nothing new got booked or delivered."}
          </p>
          <p className="mt-0.5 text-sm text-ink-600">
            {needsYou ? `${needsYou} thing${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you, below.` : "Nothing needs you."}
          </p>
        </div>
        <button type="button" aria-label="Close" onClick={() => setClosed(true)} className="rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
          <X className="h-4 w-4" />
        </button>
      </div>
    </AttentionCard>
  );
}
