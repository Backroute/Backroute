"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { SwipeToConfirm } from "@/components/shared/swipe-to-confirm";
import { usePrimaryDriver } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { DVIR_CHECKLIST } from "@/lib/dvir";

/**
 * The pre-trip on a day nothing's wrong: the driver walks around the truck as always, then logs it from the trip card
 * with one swipe instead of tapping through ten OKs. Anything wrong still goes through the full inspection, with a
 * photo of it.
 */
export function QuickPreTrip() {
  const driver = usePrimaryDriver();
  const submitDvir = useStore((s) => s.actions.submitDvir);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (!driver.truckId) return null;
  if (done)
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-white/85" role="status">
        <CheckCircle2 className="h-3.5 w-3.5" /> Pre-trip logged, no defects.
      </p>
    );
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-white/25 px-3.5 py-2 text-xs font-semibold text-white">
        All good
      </button>
    );
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs leading-snug text-white/75">I checked {DVIR_CHECKLIST.join(", ").toLowerCase()} and found nothing wrong.</p>
      <SwipeToConfirm
        label="Swipe: no defects"
        onConfirm={() => {
          submitDvir(driver.id, driver.truckId, "pre_trip", DVIR_CHECKLIST.map((label) => ({ label, status: "ok" as const })));
          setDone(true);
        }}
      />
      <button type="button" onClick={() => setOpen(false)} className="self-start text-xs text-white/60 underline-offset-2 hover:underline">
        Never mind
      </button>
    </div>
  );
}
