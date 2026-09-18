import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoadStage } from "@/lib/types";

const STEPS = [
  { key: "dispatched", label: "Dispatched" },
  { key: "at_pickup", label: "At pickup" },
  { key: "in_transit", label: "In transit" },
  { key: "at_delivery", label: "At delivery" },
  { key: "delivered", label: "Delivered" },
];

/** completed = index of the last finished step (-1 = none yet); active = the step currently underway.
 *  Five real milestones, not four — "at_delivery" (arrived at dropoff, not yet confirmed) is its own
 *  step. Folding it into "Delivered" made the Delivered node light up/pulse before the load was
 *  actually delivered, which read as the trip finishing early. */
function stepStatus(stage: LoadStage): { completed: number; active: number } {
  switch (stage) {
    case "dispatched": return { completed: -1, active: 0 };
    case "at_pickup": return { completed: 0, active: 1 };
    case "in_transit": return { completed: 1, active: 2 };
    case "at_delivery": return { completed: 2, active: 3 };
    case "delivered": return { completed: 4, active: 4 };
    default: return { completed: -1, active: 0 };
  }
}

/** Named-milestone tracker (Dispatched -> At pickup -> In transit -> At delivery -> Delivered), the
 *  discrete complement to TripProgress's continuous line — for the detail page, where a driver
 *  checking "more info" wants to see exactly which checkpoints are done, not just an overall percentage. */
export function TripStepper({ stage, invert }: { stage: LoadStage; invert?: boolean }) {
  const { completed, active } = stepStatus(stage);
  return (
    <div className="flex items-start">
      {STEPS.map((step, i) => {
        const done = i <= completed;
        const isActive = i === active && !done;
        return (
          <div key={step.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {i > 0 && (
                <div
                  className={cn(
                    "h-0.5 flex-1 transition-colors duration-500",
                    i <= completed + 1 ? (invert ? "bg-white" : "bg-ink-950") : invert ? "bg-white/15" : "bg-ink-100",
                  )}
                />
              )}
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  done
                    ? invert ? "border-white bg-white" : "border-ink-950 bg-ink-950"
                    : isActive
                      ? cn("animate-pulse bg-transparent", invert ? "border-white" : "border-ink-950")
                      : cn("bg-transparent", invert ? "border-white/25" : "border-ink-200"),
                )}
              >
                {done && <Check className={cn("h-3 w-3", invert ? "text-ink-950" : "text-white")} strokeWidth={3} />}
              </div>
            </div>
            <span
              className={cn(
                "mt-1.5 text-center text-[9px] font-medium leading-tight",
                done || isActive ? (invert ? "text-white" : "text-ink-950") : invert ? "text-white/40" : "text-ink-400",
              )}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
