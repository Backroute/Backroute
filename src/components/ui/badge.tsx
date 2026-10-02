import * as React from "react";
import { STATUS_CLASS } from "@/lib/status";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "dark";

// The same colors as every status in the app (lib/status): success is done, warning is waiting on someone, danger
// needs you, info is in progress.
const toneClasses: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  success: STATUS_CLASS.done,
  warning: STATUS_CLASS.waiting,
  danger: STATUS_CLASS.needs_you,
  info: STATUS_CLASS.moving,
  dark: "bg-ink-950 text-white",
};

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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-tight whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
