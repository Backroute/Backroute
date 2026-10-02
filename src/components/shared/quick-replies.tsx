"use client";

import { DISPATCH_UI, type QuickKey } from "@/lib/lang/dispatch-ui";
import { usePrimaryDriver } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import type { LoadStage } from "@/lib/types";
import { cn } from "@/lib/utils";

/** What a driver usually needs to say at each point of a trip, as buttons. */
const BY_STAGE: Partial<Record<LoadStage | "none", QuickKey[]>> = {
  dispatched: ["onWay", "late", "address"],
  rate_confirmed: ["onWay", "address"],
  booked: ["onWay", "address"],
  at_pickup: ["loaded", "waiting", "lumper"],
  in_transit: ["onTime", "late", "parking"],
  at_delivery: ["unloaded", "waiting", "lumper"],
  none: ["nextLoad", "goHome", "dayOff"],
};

/**
 * One-tap answers to dispatch, in the driver's app language, picked for where they are on the trip. The AI reads them
 * like any message. `onSent` lets a page show what happened.
 */
export function QuickReplies({ stage, className, onSent, dark }: { stage: LoadStage | null; className?: string; onSent?: (text: string) => void; dark?: boolean }) {
  const driver = usePrimaryDriver();
  const sendMessage = useStore((s) => s.actions.sendDriverMessage);
  const t = DISPATCH_UI[driver.prefs?.appLanguage ?? "en"];
  const keys = BY_STAGE[stage && BY_STAGE[stage] ? stage : "none"] ?? [];
  if (!keys.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label="Quick replies to dispatch">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => {
            sendMessage(driver.id, t.quick[k]);
            onSent?.(t.quick[k]);
          }}
          className={cn(
            "min-h-11 rounded-full border px-4 py-2 text-sm font-medium",
            dark ? "border-white/20 text-white hover:bg-white/10" : "border-line bg-white text-ink-900 hover:bg-ink-50",
          )}
        >
          {t.quick[k]}
        </button>
      ))}
    </div>
  );
}
