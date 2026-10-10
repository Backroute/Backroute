"use client";

import { ChevronRight } from "lucide-react";
import { StatusMark } from "@/components/ui/mark";
import { useNow } from "@/lib/hooks";
import { tripState } from "@/lib/trip-state";
import type { Load } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

/**
 * One truck on a load, in one line: who, where it's headed, how it's going, and a thin bar for how far along. Many
 * trucks fit on a phone screen; a tap opens the whole trip.
 */
export function LiveLoadRow({ load, who, needsPreTrip, onOpen }: { load: Load; who: string; needsPreTrip: boolean; onOpen: () => void }) {
  const now = useNow();
  const s = tripState(load, now, needsPreTrip);
  const place = s.card === "booking" ? `${load.lane.origin} → ${load.lane.destination}` : s.card === "pickup" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;
  const late = load.late && load.late.stop === (s.card === "delivery" ? "delivery" : "pickup") ? load.late : null;
  const status = late
    ? `Late · ETA ${formatTime(late.eta)}`
    : s.card === "booking"
      ? "Booking"
      : s.arrived
        ? s.card === "pickup" ? "At the shipper" : "At the receiver"
        : `${s.card === "pickup" ? "To pickup" : "To delivery"}${s.drive ? ` · ${s.drive}` : ""}`;
  const progress = s.card === "booking" ? s.done : s.done / s.total;
  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50" aria-label={`${who}: ${place}, ${status}`}>
      <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
        <StatusMark kind={late ? "needs_you" : s.arrived ? "waiting" : "moving"} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink-950">{place}</span>
          <span className={cn("shrink-0 text-xs font-medium", late ? "text-[var(--accent-danger)]" : "text-ink-600")}>{status}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-xs text-ink-500">
            {who} · {load.referenceNumber}
          </span>
          <span aria-hidden className="ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full bg-ink-100">
            <span className="block h-full rounded-full bg-ink-950" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
          </span>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-ink-600" />
    </button>
  );
}
