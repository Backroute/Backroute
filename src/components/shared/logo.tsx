import { cn } from "@/lib/utils";

export function Logo({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={cn(
        "font-display text-xl font-bold tracking-tighter",
        dark ? "text-white" : "text-ink-950",
        className,
      )}
    >
      Backroute
    </span>
  );
}
