import { cn } from "@/lib/utils";

export function LiveDot({ label = "Live", className, tone = "live" }: { label?: string; className?: string; tone?: "live" | "muted" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider", className)}>
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full animate-pulse-dot",
            tone === "live" ? "bg-[var(--accent-live)]" : "bg-ink-400",
          )}
        />
      </span>
      <span className={tone === "live" ? "text-[var(--accent-live)]" : "text-ink-500"}>{label}</span>
    </span>
  );
}
