import { cn } from "@/lib/utils";

export function Logo({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={cn(
        "font-display text-xl font-semibold tracking-tight",
        dark ? "text-white" : "text-ink-950",
        className,
      )}
    >
      Backroute
    </span>
  );
}
