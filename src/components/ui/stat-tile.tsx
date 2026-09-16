import * as React from "react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  sublabel,
  trend,
  className,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  trend?: { direction: "up" | "down"; value: string; good?: boolean };
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-500">{label}</span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-display tabular text-ink-950",
            size === "lg" ? "text-4xl" : size === "md" ? "text-3xl" : "text-2xl",
          )}
        >
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium tabular",
              trend.good === false ? "text-[var(--accent-danger)]" : "text-[var(--accent-live)]",
            )}
          >
            {trend.direction === "up" ? "↑" : "↓"} {trend.value}
          </span>
        )}
      </div>
      {sublabel && <span className="text-xs text-ink-500">{sublabel}</span>}
    </div>
  );
}
