import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOURNEY_STEPS, journeyStates, type NextLoadStatus } from "@/lib/load-status";
import type { LoadStage } from "@/lib/types";

/** The whole job on one line — Book → Pickup → Deliver → Get paid → Next load — with who owns each
 *  step, so it's obvious the AI covers everything except the physical driving. */
export function LoadJourney({
  stage,
  next,
  perspective,
  invert,
  compact,
  className,
}: {
  stage: LoadStage;
  next: NextLoadStatus;
  perspective: "driver" | "carrier";
  invert?: boolean;
  /** Carrier fleet rows: segments + labels, no owner tags. */
  compact?: boolean;
  className?: string;
}) {
  const states = journeyStates(stage, next);
  const driverLabel = perspective === "driver" ? "You" : "Driver";

  return (
    <ol className={cn("grid grid-cols-5 gap-1", className)} aria-label="Load progress">
      {JOURNEY_STEPS.map((step, i) => {
        // A driver step waiting on the driver isn't something the carrier has to act on — only the next-load pick is.
        const needsYou = states[i].needsYou && (perspective === "driver" || step.key === "next");
        const { state } = states[i];
        const done = state === "done";
        const current = state === "current";
        const ownerLabel = step.key === "next" && next === "choose" ? "Pick" : step.owner === "ai" ? "AI" : driverLabel;
        const statusText = done ? "done" : current ? (needsYou ? "needs you" : "in progress") : "upcoming";

        return (
          <li key={step.key} className="flex min-w-0 flex-col items-center gap-1 text-center" aria-label={`${step.label}, ${ownerLabel}, ${statusText}`}>
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : segmentTone(states[i - 1].state === "done", invert))} />
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full",
                  compact ? "h-3 w-3" : "h-5 w-5",
                  done && (invert ? "bg-white text-ink-950" : "bg-ink-950 text-white"),
                  current && needsYou && "bg-[var(--accent-warn)] text-white ring-4 ring-[var(--accent-warn)]/25",
                  current && !needsYou && (invert ? "bg-white/15 ring-2 ring-white" : "bg-white ring-2 ring-ink-950"),
                  state === "upcoming" && (invert ? "border border-white/30" : "border border-ink-200 bg-white"),
                )}
              >
                {done && !compact && <Check className="h-3 w-3" strokeWidth={3} />}
                {current && !needsYou && !compact && <span className={cn("h-1.5 w-1.5 animate-pulse rounded-full", invert ? "bg-white" : "bg-ink-950")} />}
              </span>
              <span className={cn("h-0.5 flex-1", i === JOURNEY_STEPS.length - 1 ? "opacity-0" : segmentTone(done, invert))} />
            </div>
            <span
              className={cn(
                "truncate text-[10px] leading-tight",
                current ? (invert ? "font-semibold text-white" : "font-semibold text-ink-950") : invert ? "text-white/50" : "text-ink-400",
              )}
            >
              {step.label}
            </span>
            {!compact && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
                  needsYou
                    ? "bg-[var(--accent-warn)] text-white"
                    : ownerLabel === "AI"
                      ? invert ? "bg-white/10 text-white/60" : "bg-ink-100 text-ink-500"
                      : invert ? "text-white/40" : "text-ink-400",
                )}
              >
                {ownerLabel}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function segmentTone(filled: boolean, invert?: boolean) {
  if (filled) return invert ? "bg-white" : "bg-ink-950";
  return invert ? "bg-white/15" : "bg-ink-200";
}
