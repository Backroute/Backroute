import { cn } from "@/lib/utils";
import { transitProgress } from "@/lib/load-status";
import type { LoadStage } from "@/lib/types";

/** Uber-style route line for the physical pickup-to-delivery trip: a marker that slides along as the
 *  stage advances, instead of a generic percent bar that doesn't say where on the route the truck is. */
export function TripProgress({ stage, invert }: { stage: LoadStage; invert?: boolean }) {
  const pct = transitProgress(stage);
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", invert ? "bg-white" : "bg-ink-950")} />
      <div className={cn("relative h-1 flex-1 rounded-full", invert ? "bg-white/15" : "bg-ink-100")}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", invert ? "bg-white" : "bg-ink-950")}
          style={{ width: `${pct}%` }}
        />
        <span
          className={cn(
            "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 transition-[left] duration-700 ease-out",
            invert ? "border-ink-950 bg-white" : "border-white bg-ink-950",
          )}
          style={{ left: `calc(${pct}% - 5px)` }}
        />
      </div>
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full border-2",
          invert ? "border-white" : "border-ink-950",
          pct >= 100 ? (invert ? "bg-white" : "bg-ink-950") : "bg-transparent",
        )}
      />
    </div>
  );
}
