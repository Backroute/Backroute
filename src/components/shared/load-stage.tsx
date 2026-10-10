import { cn } from "@/lib/utils";
import { STAGE_STATUS, STATUS_PILL } from "@/lib/status";
import { StatusMark } from "@/components/ui/mark";
import { LOAD_STAGE_LABEL, type LoadStage } from "@/lib/types";

/** A load's stage: a grey pill with the status mark every other status in the app uses (lib/status). */
export function LoadStagePill({ stage, className }: { stage: LoadStage; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", STATUS_PILL, className)}>
      <StatusMark kind={STAGE_STATUS[stage]} />
      {LOAD_STAGE_LABEL[stage]}
    </span>
  );
}
