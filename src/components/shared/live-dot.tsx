import { cn } from "@/lib/utils";

/**
 * A short status note with a quiet dot, e.g. what Backroute is doing on a load. With no note there's nothing to say,
 * so nothing shows: pages don't announce that they're "live".
 */
export function LiveDot({ label, className }: { label?: string; className?: string }) {
  if (!label) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-ink-600", className)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-950" />
      {label}
    </span>
  );
}
