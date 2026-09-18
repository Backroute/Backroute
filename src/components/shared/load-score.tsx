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
    // A round-capped SVG ring (Apple Watch activity-ring construction) reads as far more premium than a
    // conic-gradient at this size, and it's the score decisions actually get made on — carriers and drivers
    // pick between load offers by scanning these, so it's sized to be unmissable rather than merely legible.
    const dim = 96;
    const strokeWidth = 7;
    const radius = (dim - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.max(0.03, Math.min(1, score / 100));
    const dashOffset = circumference * (1 - progress);
    const ringColor = invert ? "#fff" : RING_COLOR[tone];
    const trackColor = invert ? "rgba(255,255,255,0.15)" : "rgba(10,10,10,0.08)";
    return (
      <div className={cn("relative shrink-0", className)} style={{ width: dim, height: dim }}>
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="-rotate-90">
          <circle cx={dim / 2} cy={dim / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-display text-[34px] font-bold leading-none tabular", invert ? "text-white" : "text-ink-950")}>{score}</span>
          <span className={cn("mt-1 text-[9px] font-semibold uppercase tracking-wider", invert ? "text-white/50" : "text-ink-400")}>Match score</span>
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
