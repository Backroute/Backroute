"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";
import { TYPE_ICON, SEVERITY_TONE } from "./activity-feed";

const MAX_VISIBLE = 3;
const DISMISS_MS = 5000;

/**
 * Simulates a phone push notification for real activity — not a toast on every render, only for
 * events that show up *after* this mounts, so the seed history doesn't dump a wall of toasts on
 * first load. Sits on top of the existing bell dropdown rather than replacing it: the bell is the
 * full log, this is "something just happened and you weren't looking."
 *
 * Each toast gets its own dismiss timer, scheduled exactly once when it's added. Toasts arrive
 * faster than they used to auto-dismiss on a busy portal (tick every 4.2s vs. an old shared timer
 * keyed off array length), so a single re-triggerable timer meant anything added once the list hit
 * its cap never got a timer at all and just sat there piling up. Per-toast timers plus a hard cap
 * fix both: nothing lingers, and nothing can pile up past MAX_VISIBLE regardless of how fast events
 * arrive.
 */
export function NotificationToastHost({ events, hrefFor }: { events: ActivityEvent[]; hrefFor?: (e: ActivityEvent) => string | undefined }) {
  const [toasts, setToasts] = useState<ActivityEvent[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function clearTimer(id: string) {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }

  function dismiss(id: string) {
    clearTimer(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function schedule(id: string) {
    clearTimer(id);
    timers.current.set(
      id,
      setTimeout(() => dismiss(id), DISMISS_MS),
    );
  }

  useEffect(() => {
    if (seen.current === null) {
      // First render: remember what's already there so the seed history never toasts.
      seen.current = new Set(events.map((e) => e.id));
      return;
    }
    const fresh = events.filter((e) => !seen.current!.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => seen.current!.add(e.id));

    setToasts((prev) => {
      const incoming = fresh.slice(0, MAX_VISIBLE);
      const next = [...incoming, ...prev].slice(0, MAX_VISIBLE);
      const nextIds = new Set(next.map((t) => t.id));
      // Anything bumped off by the cap loses its pending timer along with its slot.
      prev.forEach((t) => { if (!nextIds.has(t.id)) clearTimer(t.id); });
      incoming.forEach((t) => schedule(t.id));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(() => {
    const timerMap = timers.current;
    return () => {
      timerMap.forEach((t) => clearTimeout(t));
      timerMap.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-h-[60vh] flex-col gap-2 overflow-hidden sm:bottom-6 sm:right-6">
      {toasts.map((t) => {
        const Icon = TYPE_ICON[t.type];
        const href = hrefFor?.(t);
        const inner = (
          <div className="pointer-events-auto flex w-[19rem] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-2xl animate-rise-in">
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
