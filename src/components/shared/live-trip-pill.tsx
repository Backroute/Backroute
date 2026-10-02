"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2 } from "lucide-react";
import { useNow } from "@/lib/hooks";
import { tripState } from "@/lib/trip-state";
import { haptic } from "@/lib/feedback";
import type { Load } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The trip, always in view, like an iPhone Live Activity: a small black pill at the top of every screen while a load
 * is on, with where you're headed and how long. Tap it and it opens up to show what's next and how far along the
 * trip is.
 */
export function LiveTripPill({ load, href }: { load: Load; href: string }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const s = tripState(load, now, false);
  const pickup = s.card === "pickup";
  const place = s.card === "booking" ? "Booking" : pickup ? load.lane.origin : load.lane.destination;
  const short = s.card === "booking" ? "AI on it" : s.arrived ? "Arrived" : s.drive.split(" · ")[0];
  const pct = Math.round((s.done / s.total) * 100);

  return (
    <div className="pointer-events-none sticky top-[4.25rem] z-20 mb-2 flex min-h-9 items-start justify-center">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 500, damping: 38 }}
        style={{ borderRadius: 22 }}
        className={cn("theme-ink pointer-events-auto overflow-hidden bg-ink-950 text-white shadow-[0_8px_24px_rgb(0_0_0/0.25)]", open ? "w-[calc(100%-2.5rem)] max-w-sm" : "")}
      >
        <motion.button
          layout="position"
          type="button"
          onClick={() => {
            haptic("tap");
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          aria-label={`Trip: ${place}, ${short}`}
          className="flex items-center gap-2 px-3.5 py-2 text-left text-xs font-semibold"
        >
          {s.card === "booking" ? (
            <Loader2 className="h-3 w-3 animate-spin text-white/70" />
          ) : (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-live)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent-live)]" />
            </span>
          )}
          <span className="max-w-[9rem] truncate">{place}</span>
          <span className="tabular text-white/60">{short}</span>
        </motion.button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="px-3.5 pb-3">
              <span className="block text-[11px] uppercase tracking-wider text-white/50">{s.card === "booking" ? "Booking" : pickup ? "Pickup" : "Delivery"} · {load.referenceNumber}</span>
              <span className="mt-0.5 block text-sm font-semibold">Next: {s.next.title}</span>
              {s.card !== "booking" && !s.arrived && <span className="mt-0.5 block text-xs tabular text-white/60">{s.drive}</span>}
              <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/15">
                <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
              </span>
              <Link href={href} onClick={() => setOpen(false)} className="mt-3 flex items-center justify-center gap-1 rounded-full bg-white py-2 text-xs font-semibold text-ink-950">
                Open the trip <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
