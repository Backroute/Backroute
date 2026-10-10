"use client";

import Link from "next/link";
import { StatusMark } from "@/components/ui/mark";
import { useNow } from "@/lib/hooks";
import { stopDates } from "@/lib/load-dates";
import { useCarrierLoads, useDriverMap, useTruckMap } from "@/lib/selectors";
import type { StatusKind } from "@/lib/status";
import type { Load, LoadStage } from "@/lib/types";

/** Booked through delivered: loads with a stop on the calendar. */
const ON_CALENDAR: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"];
const PICKED_UP: LoadStage[] = ["in_transit", "at_delivery", "delivered"];

interface Stop {
  key: string;
  load: Load;
  kind: "pickup" | "delivery";
  city: string;
  time: string | null;
  at: number;
  relative: string | null;
  state: { mark: StatusKind; word: string };
}

function stateOf(load: Load, kind: "pickup" | "delivery"): Stop["state"] {
  const done = kind === "pickup" ? PICKED_UP.includes(load.stage) : load.stage === "delivered";
  if (done) return { mark: "done", word: kind === "pickup" ? "Picked up" : "Delivered" };
  if ((kind === "pickup" ? load.stage === "at_pickup" : load.stage === "at_delivery")) return { mark: "moving", word: "At the dock" };
  if (load.late?.stop === kind) return { mark: "needs_you", word: `Late, about ${load.late.eta}` };
  return { mark: "moving", word: "On time" };
}

/**
 * Every pickup and delivery across the fleet for today, in time order, with whether each is done, at the dock, on time
 * or late: the owner's day at a glance instead of opening every load. When nothing is on today, tomorrow's.
 */
export function TodayBoard() {
  const loads = useCarrierLoads();
  const trucks = useTruckMap();
  const drivers = useDriverMap();
  const now = useNow();
  if (now === null) return null;

  const stops: Stop[] = [];
  for (const load of loads) {
    if (!ON_CALENDAR.includes(load.stage) || !load.truckId) continue;
    const when = stopDates(load, now);
    for (const kind of ["pickup", "delivery"] as const) {
      const w = when[kind];
      if (w.relative !== "Today" && w.relative !== "Tomorrow") continue;
      stops.push({
        key: `${load.id}-${kind}`,
        load,
        kind,
        city: kind === "pickup" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`,
        time: w.time,
        at: w.at ?? w.day ?? 0,
        relative: w.relative,
        state: stateOf(load, kind),
      });
    }
  }
  const today = stops.filter((s) => s.relative === "Today");
  const shown = (today.length ? today : stops.filter((s) => s.relative === "Tomorrow")).sort((a, b) => a.at - b.at);
  const late = today.filter((s) => s.state.mark === "needs_you").length;

  return (
    <section aria-labelledby="today-title" className="rounded-3xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-title" className="text-sm font-semibold text-ink-950">
          {today.length || !shown.length ? "Today's stops" : "Tomorrow's stops"}
        </h2>
        <span className="text-xs text-ink-500">
          {today.length ? `${today.length} stop${today.length === 1 ? "" : "s"}${late ? ` · ${late} late` : ""}` : shown.length ? "Nothing today" : ""}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No pickups or deliveries today or tomorrow.</p>
      ) : (
        <ol className="mt-3 flex flex-col">
          {shown.map((s) => {
            const truck = s.load.truckId ? trucks.get(s.load.truckId) : undefined;
            const driver = truck?.driverId ? drivers.get(truck.driverId) : undefined;
            return (
              <li key={s.key} className="border-t border-line first:border-0">
                <Link href={`/carrier/loads/${s.load.id}`} className="flex items-center gap-3 py-2.5 hover:bg-ink-50">
                  <span className="w-20 shrink-0 text-xs tabular text-ink-500">{s.time ?? "Any time"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {s.kind === "pickup" ? "Pickup" : "Delivery"} · {s.city}
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      {truck?.unitNumber ?? "Truck"}
                      {driver ? ` · ${driver.name}` : ""} · {s.load.referenceNumber}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-700">
                    <StatusMark kind={s.state.mark} /> {s.state.word}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
