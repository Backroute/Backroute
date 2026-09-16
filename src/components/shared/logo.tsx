import { cn } from "@/lib/utils";

export function Logo({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-xl tracking-tight", className)}>
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-bold not-italic",
          dark ? "bg-white text-ink-950" : "bg-ink-950 text-white",
        )}
      >
        B
      </span>
      <span className={dark ? "text-white" : "text-ink-950"}>Backroute</span>
    </span>
  );
}
