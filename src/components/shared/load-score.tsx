import { cn } from "@/lib/utils";

/**
 * How well a load fits, 0–100. Plain black, like every other number: a low score isn't an alarm, so it gets no colour.
 * The ring's fill shows the size of it at a glance.
 */
export function LoadScoreBadge({
  score,
  size = "md",
  invert,
  className,
}: {
  score: number;
  /** "xl" is the ring, for wherever someone is choosing between loads. */
  size?: "sm" | "md" | "lg" | "xl";
  invert?: boolean;
  className?: string;
}) {
  if (size === "xl") {
    const dim = 76;
    const strokeWidth = 5;
    const radius = (dim - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.max(0.03, Math.min(1, score / 100));
    const dashOffset = circumference * (1 - progress);
    return (
      <div className={cn("relative shrink-0", className)} style={{ width: dim, height: dim }} aria-label={`Fit ${score} out of 100`}>
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="-rotate-90" aria-hidden>
          <circle cx={dim / 2} cy={dim / 2} r={radius} fill="none" stroke={invert ? "rgb(255 255 255 / 0.16)" : "var(--ink-150)"} strokeWidth={strokeWidth} />
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke={invert ? "#fff" : "var(--ink-950)"}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
        </svg>
        <span className={cn("absolute inset-0 flex items-center justify-center text-[26px] font-medium leading-none tracking-tight tabular", invert ? "text-white" : "text-ink-950")}>
          {score}
        </span>
      </div>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-baseline rounded-full font-medium tabular",
        invert ? "bg-white/15 text-white" : "bg-ink-100 text-ink-950",
        size === "lg" ? "px-3 py-1 text-lg" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-sm",
        className,
      )}
      title="Fit, out of 100"
    >
      {score}
    </span>
  );
}
