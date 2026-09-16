import { cn } from "@/lib/utils";
import { scoreTone } from "@/lib/scoring";

const TONE_CLASSES = {
  success: "bg-emerald-50 text-[var(--accent-live)]",
  warning: "bg-amber-50 text-[var(--accent-warn)]",
  danger: "bg-red-50 text-[var(--accent-danger)]",
};

export function LoadScoreBadge({
  score,
  size = "md",
  invert,
  className,
}: {
  score: number;
  size?: "sm" | "md" | "lg";
  invert?: boolean;
  className?: string;
}) {
  const tone = scoreTone(score);
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-0.5 rounded-full font-semibold tabular",
        invert ? "bg-white/15 text-white" : TONE_CLASSES[tone],
        size === "lg" ? "px-3 py-1.5 text-lg" : size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-sm",
        className,
      )}
    >
      {score}
      <span className={cn("font-normal opacity-60", size === "lg" ? "text-xs" : "text-[10px]")}>/100</span>
    </span>
  );
}
