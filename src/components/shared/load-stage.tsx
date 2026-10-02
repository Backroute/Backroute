import { cn } from "@/lib/utils";
import { STAGE_STATUS, STATUS_CLASS } from "@/lib/status";
import { LOAD_STAGE_LABEL, type LoadStage } from "@/lib/types";

/** A load's stage, in the same colors as every other status in the app (lib/status). */
export function LoadStagePill({ stage, className }: { stage: LoadStage; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap", STATUS_CLASS[STAGE_STATUS[stage]], className)}>
      {LOAD_STAGE_LABEL[stage]}
    </span>
  );
}
