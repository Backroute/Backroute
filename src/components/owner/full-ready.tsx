"use client";

import { Check, Circle } from "lucide-react";
import { useStore } from "@/lib/store";
import { useCarrierEscalations, useCarrierLoads } from "@/lib/selectors";
import { useNow } from "@/lib/hooks";
import { fullModeReady, reportCard } from "@/lib/report-card";

/**
 * What Backroute has shown on "Within my rules" before full autopilot, the way you'd watch a new dispatcher for a few
 * weeks first. Advice, not a lock: the owner can turn full on any time.
 */
export function FullReady() {
  const autonomy = useStore((s) => s.settings.autonomy);
  const loads = useCarrierLoads();
  const escalations = useCarrierEscalations();
  const now = useNow();
  if (now === null || autonomy === "ask") return null;
  const { ready, checks } = fullModeReady(reportCard(loads, escalations, now));
  return (
    <div className="mt-3 rounded-xl bg-ink-50 px-3 py-2.5" aria-label="Ready for full autopilot">
      <p className="text-xs font-medium text-ink-800">
        {ready ? "Backroute has earned full autopilot: the last 30 days hit every mark." : autonomy === "full" ? "On full autopilot. How the last 30 days measure up:" : "Before full autopilot, the last 30 days should show:"}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-1.5 text-xs text-ink-600">
            {c.met ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-live)]" aria-label="Met" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" aria-label="Not yet" />}
            <span>
              {c.label} <span className="text-ink-400">({c.now})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
