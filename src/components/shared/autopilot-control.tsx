"use client";

import { useStore, AUTONOMY_DETAIL, AUTONOMY_LABEL, type Autonomy } from "@/lib/store";
import { cn } from "@/lib/utils";

const LEVELS: Autonomy[] = ["ask", "rules", "full"];

/** What each level does in a real account today: the AI answers drivers on its own; this decides broker emails. */
const REAL_DETAIL: Record<Autonomy, string> = {
  ask: "The AI answers drivers and checks in with them on its own. Every email to a broker (book requests, invoices, replies) waits for your OK.",
  rules: "The AI also asks to book loads, counters, accepts, sends invoices, detention claims and setup packets on its own, but only at or above your lowest rate per mile. Replies it writes itself, and anything under your lowest, wait for you.",
  full: "Everything in Within my rules, plus it sends the replies it writes. A reply that names a new price, or anything under your lowest rate, still waits for you.",
};

/** The one autopilot setting — how much the AI books without asking. */
export function AutopilotControl({ dark }: { dark?: boolean }) {
  const autonomy = useStore((s) => s.settings.autonomy);
  const setAutonomy = useStore((s) => s.actions.setAutonomy);
  const real = useStore((s) => s.session.mode !== "demo");
  return (
    <div>
      <div role="radiogroup" aria-label="Autopilot" className={cn("grid grid-cols-3 gap-1 rounded-full p-1", dark ? "bg-white/10" : "bg-ink-100")}>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={autonomy === level}
            onClick={() => setAutonomy(level)}
            className={cn(
              "rounded-full px-2 py-2 text-xs font-semibold transition-colors",
              autonomy === level ? (dark ? "bg-white text-ink-950" : "bg-ink-950 text-white") : dark ? "text-white/70 hover:text-white" : "text-ink-600 hover:text-ink-950",
            )}
          >
            {AUTONOMY_LABEL[level]}
          </button>
        ))}
      </div>
      <p className={cn("mt-2 text-xs", dark ? "text-white/60" : "text-ink-500")}>{(real ? REAL_DETAIL : AUTONOMY_DETAIL)[autonomy]}</p>
    </div>
  );
}
