"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { tripLoads, tripStops } from "@/lib/trip-plan";
import type { Load, Truck } from "@/lib/types";
import { useMounted } from "@/lib/hooks";
import { stopDates, type StopWhen } from "@/lib/load-dates";

/** "Mon, Oct 5 · 6 am–4 pm CDT", the stop's own day and hours; the load's words when it has no date. */
const whenText = (w: StopWhen | undefined, raw: string) => (w?.date ? [w.date, w.time].filter(Boolean).join(" · ") : raw);

/**
 * A multi-load trip on the driver's screen: every pickup and drop in the order the AI planned them, the one they're
 * heading to marked, each opening its own load (paperwork, times, directions). Restacks to plan for are said up top.
 */
export function TripStops({ truck, loads, hrefFor }: { truck: Truck; loads: Load[]; hrefFor: (loadId: string) => string }) {
  const stops = tripStops(truck, loads);
  const mounted = useMounted();
  const on = tripLoads(truck, loads);
  if (stops.length < 3 || !on.length) return null;
  const nextAt = stops.findIndex((s) => !s.done);
  return (
    <section className="rounded-3xl border border-line p-5" aria-label="Your trip">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-400">Your trip</h2>
        <span className="text-xs text-ink-500">
          {new Set(stops.map((s) => s.load.id)).size} loads · stop {nextAt + 1} of {stops.length}
        </span>
      </div>
      {truck.trip?.warnings?.map((w) => (
        <p key={w} className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-700">
          {w}
        </p>
      ))}
      <ol className="mt-3 flex flex-col">
        {stops.map(({ stop, load, done }, i) => {
          const pickup = stop.kind === "pickup";
          const here = i === nextAt;
          return (
            <li key={`${stop.loadId}-${stop.kind}`}>
              <Link href={hrefFor(load.id)} className={`flex min-h-12 items-center gap-3 border-b border-line py-2 last:border-0 ${done ? "text-ink-400" : "text-ink-900"}`} aria-current={here ? "step" : undefined}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${here ? "bg-ink-950 text-white" : done ? "bg-ink-100 text-ink-500" : "border border-line text-ink-600"}`}>
                  {done ? <Check className="h-3.5 w-3.5" aria-label="Done" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {pickup ? "Pick up" : "Drop"} {load.referenceNumber} · {pickup ? load.lane.origin : load.lane.destination}, {pickup ? load.lane.originState : load.lane.destState}
                  </span>
                  <span className="block truncate text-xs text-ink-500">
                    {whenText(mounted ? stopDates(load)[pickup ? "pickup" : "delivery"] : undefined, pickup ? load.pickupWindow : load.deliveryWindow)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
