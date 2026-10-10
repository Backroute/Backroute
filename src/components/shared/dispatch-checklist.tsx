"use client";

import { useNow } from "@/lib/hooks";
import { dispatchChecks } from "@/lib/dispatch-checks";
import type { Driver, Load } from "@/lib/types";
import { StatusMark } from "@/components/ui/mark";
import { cn } from "@/lib/utils";

/**
 * Before the truck rolls: the driver's hours, CDL and medical card past delivery, and the endorsements the load needs.
 * A stop in red (the AI won't put a load on a driver who can't legally run it); a heads-up for what's not on file.
 */
export function DispatchChecklist({ load, driver, className }: { load: Load; driver: Driver; className?: string }) {
  const now = useNow();
  if (now === null) return null;
  const checks = dispatchChecks(load, driver, now);
  const stops = checks.filter((c) => c.hard);
  return (
    <div className={cn("rounded-xl bg-ink-50 px-3 py-2.5", className)} aria-label="Before dispatch">
      <p className="text-xs font-medium text-ink-900">{stops.length ? `Can't run it yet: ${stops.map((c) => c.label).join(", ")}` : "Before dispatch"}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {checks.map((c) => (
          <li key={c.key} className="flex gap-2 text-xs">
            <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
              <StatusMark kind={c.ok ? "done" : c.hard ? "needs_you" : "waiting"} />
            </span>
            <span>
              <span className={cn("font-medium", c.hard ? "text-[var(--accent-danger)]" : "text-ink-900")}>{c.label}</span>
              <span className="text-ink-500"> · {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
