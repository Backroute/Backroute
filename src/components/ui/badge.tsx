import * as React from "react";
import { STATUS_DOT, STATUS_PILL, type StatusKind } from "@/lib/status";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "dark";

// A grey pill; the tone shows as a small dot, the same meanings as every status in the app (lib/status).
const TONE_STATUS: Partial<Record<Tone, StatusKind>> = { success: "done", warning: "waiting", danger: "needs_you", info: "moving" };

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const status = TONE_STATUS[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tracking-tight whitespace-nowrap",
        tone === "dark" ? "bg-ink-950 text-white" : tone === "neutral" ? "bg-ink-100 text-ink-700" : STATUS_PILL,
        className,
      )}
    >
      {(status || dot) && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status ? STATUS_DOT[status] : "bg-current")} />}
      {children}
    </span>
  );
}
