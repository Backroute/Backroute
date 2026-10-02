"use client";

import { useMemo } from "react";
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
  const mine = useStore((s) => s.driverMessages);
  // This driver's own words: short things they've sent at least twice come first, the way they say them.
  const theirs = useMemo(() => {
    const preset = new Set(Object.values(t.quick).map((q) => q.toLowerCase()));
    const count = new Map<string, { text: string; n: number }>();
    for (const m of mine.filter((m) => m.driverId === driver.id && m.from === "driver").slice(-80)) {
      const text = m.content.trim().replace(/\s+/g, " ");
      if (text.length < 2 || text.length > 40 || /\d{3,}/.test(text) || preset.has(text.toLowerCase())) continue;
      const key = text.toLowerCase().replace(/[.!?]+$/, "");
      const prev = count.get(key);
      count.set(key, { text, n: (prev?.n ?? 0) + 1 });
    }
    return [...count.values()].filter((c) => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, 2).map((c) => c.text);
  }, [mine, driver.id, t.quick]);
  if (!keys.length && !theirs.length) return null;
  const send = (text: string) => {
    sendMessage(driver.id, text);
    onSent?.(text);
  };
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label="Quick replies to dispatch">
      {theirs.map((text) => (
        <button
          key={`mine-${text}`}
          type="button"
          onClick={() => send(text)}
          className={cn(
            "min-h-11 rounded-full border px-4 py-2 text-sm font-medium",
            dark ? "border-white/40 text-white hover:bg-white/10" : "border-ink-950 bg-white text-ink-950 hover:bg-ink-50",
          )}
        >
          {text}
        </button>
      ))}
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => send(t.quick[k])}
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
