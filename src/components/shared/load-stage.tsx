import { cn } from "@/lib/utils";
import { LOAD_STAGE_LABEL, type LoadStage } from "@/lib/types";

const STAGE_TONE: Record<LoadStage, string> = {
  sourced: "bg-ink-100 text-ink-600",
  scoring: "bg-ink-100 text-ink-600",
  negotiating: "bg-amber-50 text-[var(--accent-warn)]",
  rate_confirmed: "bg-blue-50 text-[var(--accent-info)]",
  booked: "bg-blue-50 text-[var(--accent-info)]",
  dispatched: "bg-emerald-50 text-[var(--accent-live)]",
  at_pickup: "bg-emerald-50 text-[var(--accent-live)]",
  in_transit: "bg-emerald-50 text-[var(--accent-live)]",
  at_delivery: "bg-emerald-50 text-[var(--accent-live)]",
  delivered: "bg-ink-950 text-white",
};

export function LoadStagePill({ stage, className }: { stage: LoadStage; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap", STAGE_TONE[stage], className)}>
      {LOAD_STAGE_LABEL[stage]}
    </span>
  );
}
