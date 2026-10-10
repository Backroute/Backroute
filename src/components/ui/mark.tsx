import { cn } from "@/lib/utils";
import type { StatusKind } from "@/lib/status";

/**
 * The status mark next to a status, the same on every screen. Red and orange never differ by colour alone, because
 * they're hard to tell apart that small (and for colour-blind owners): needs you now is a filled red circle with a "!",
 * waiting is an orange ring. Green done, black moving and grey set aside stay plain dots.
 */
export function StatusMark({ kind, className }: { kind: StatusKind; className?: string }) {
  if (kind === "needs_you")
    return (
      <span aria-hidden className={cn("inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--dot-danger)] text-[10px] font-bold leading-none text-white", className)}>
        !
      </span>
    );
  if (kind === "waiting") return <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[var(--dot-warn)]", className)} />;
  const dot: Record<Exclude<StatusKind, "needs_you" | "waiting">, string> = { done: "bg-[var(--dot-live)]", moving: "bg-ink-950", off: "bg-ink-300" };
  return <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot[kind], className)} />;
}
