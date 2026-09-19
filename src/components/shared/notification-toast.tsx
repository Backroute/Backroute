"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";
import { TYPE_ICON, SEVERITY_TONE } from "./activity-feed";

/**
 * Simulates a phone push notification for real activity — not a toast on every render, only for
 * events that show up *after* this mounts, so the seed history doesn't dump a wall of toasts on
 * first load. Sits on top of the existing bell dropdown rather than replacing it: the bell is the
 * full log, this is "something just happened and you weren't looking."
 */
export function NotificationToastHost({ events, hrefFor }: { events: ActivityEvent[]; hrefFor?: (e: ActivityEvent) => string | undefined }) {
  const [toasts, setToasts] = useState<ActivityEvent[]>([]);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      // First render: remember what's already there so the seed history never toasts.
      seen.current = new Set(events.map((e) => e.id));
      return;
    }
    const fresh = events.filter((e) => !seen.current!.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => seen.current!.add(e.id));
    setToasts((prev) => [...fresh.slice(0, 3), ...prev].slice(0, 4));
  }, [events]);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 6000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2 sm:bottom-6 sm:right-6">
      {toasts.map((t) => {
        const Icon = TYPE_ICON[t.type];
        const href = hrefFor?.(t);
        const inner = (
          <div className="pointer-events-auto flex w-[19rem] items-start gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-2xl animate-rise-in">
            <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", SEVERITY_TONE[t.severity])}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug text-ink-900">{t.message}</p>
              {t.detail && <p className="mt-0.5 truncate text-xs text-ink-500">{t.detail}</p>}
            </div>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss(t.id);
              }}
              className="shrink-0 text-ink-300 hover:text-ink-600"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
        return href ? (
          <Link key={t.id} href={href} onClick={() => dismiss(t.id)}>
            {inner}
          </Link>
        ) : (
          <div key={t.id}>{inner}</div>
        );
      })}
    </div>
  );
}
