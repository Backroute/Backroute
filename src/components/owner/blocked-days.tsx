"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { updateTruck } from "@/lib/back-office";
import type { Truck } from "@/lib/types";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Days the owner keeps a truck off the board (home time, the shop): Backroute books nothing that would run across them.
 * Past days drop off by themselves.
 */
export function BlockedDays({ truck, today }: { truck: Truck; today: string }) {
  const [pick, setPick] = useState("");
  const days = (truck.blockedDays ?? []).filter((d) => d >= today).sort();
  const add = (d: string) => {
    if (!d || days.includes(d)) return;
    updateTruck(truck.id, { blockedDays: [...days, d].sort() });
    setPick("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label={`${truck.unitNumber} days off the board`}>
      <span>Keep off the board</span>
      {days.map((d) => (
        <span key={d} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 font-medium text-ink-800">
          {day(d)}
          <button type="button" aria-label={`Put ${truck.unitNumber} back on the board ${day(d)}`} onClick={() => updateTruck(truck.id, { blockedDays: days.filter((x) => x !== d) })}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input type="date" min={today} value={pick} aria-label={`Add a day ${truck.unitNumber} stays off the board`} onChange={(e) => add(e.target.value)} className="rounded-full border border-line bg-white px-2 py-0.5 text-xs" />
    </div>
  );
}
