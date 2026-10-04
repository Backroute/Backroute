import { cn } from "@/lib/utils";
import { STAGE_STATUS, STATUS_DOT, STATUS_PILL } from "@/lib/status";
import { LOAD_STAGE_LABEL, type LoadStage } from "@/lib/types";

/** A load's stage: a grey pill with the status dot every other status in the app uses (lib/status). */
export function LoadStagePill({ stage, className }: { stage: LoadStage; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", STATUS_PILL, className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[STAGE_STATUS[stage]])} />
      {LOAD_STAGE_LABEL[stage]}
    </span>
  );
}
