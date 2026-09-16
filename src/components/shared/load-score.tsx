import { cn } from "@/lib/utils";
import { scoreTone } from "@/lib/scoring";

const TONE_CLASSES = {
  success: "bg-emerald-50 text-[var(--accent-live)]",
  warning: "bg-amber-50 text-[var(--accent-warn)]",
  danger: "bg-red-50 text-[var(--accent-danger)]",
};

const RING_COLOR = {
  success: "var(--accent-live)",
  warning: "var(--accent-warn)",
  danger: "var(--accent-danger)",
};

export function LoadScoreBadge({
  score,
  size = "md",
  invert,
  className,
}: {
  score: number;
  /** "xl" is the decision-prominent ring gauge — use it wherever a carrier/driver is choosing between loads. */
  size?: "sm" | "md" | "lg" | "xl";
  invert?: boolean;
  className?: string;
}) {
  const tone = scoreTone(score);

  if (size === "xl") {
    const deg = Math.max(8, Math.round((score / 100) * 360));
    const ringColor = invert ? "#fff" : RING_COLOR[tone];
    const trackColor = invert ? "rgba(255,255,255,0.15)" : "rgba(10,10,10,0.08)";
    return (
      <div
        className={cn("relative flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full", className)}
        style={{ background: `conic-gradient(${ringColor} ${deg}deg, ${trackColor} ${deg}deg)` }}
      >
        <div
          className={cn(
            "flex h-[60px] w-[60px] flex-col items-center justify-center rounded-full",
            invert ? "bg-ink-950" : "border border-line bg-white",
          )}
        >
          <span className={cn("font-display text-[26px] font-bold leading-none tabular", invert ? "text-white" : "text-ink-950")}>{score}</span>
          <span className={cn("mt-0.5 text-[9px] font-semibold uppercase tracking-wide", invert ? "text-white/50" : "text-ink-400")}>score</span>
        </div>
      </div>
    );
  }

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
