"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";
import { TYPE_ICON, SEVERITY_TONE } from "./activity-feed";
import { chime } from "@/lib/feedback";

// Two at most, so they never cover the page; the rest wait in the bell.
const MAX_VISIBLE = 2;
const DISMISS_MS = 6000;

const OPEN_BELL = "backroute:open-bell";
/** Opens the bell's list (top bar), e.g. from "3 more" under the pop-ups. */
function openBell() {
  window.dispatchEvent(new Event(OPEN_BELL));
}
export const OPEN_BELL_EVENT = OPEN_BELL;

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
  // Ones that arrived while two were already showing: counted, not shown.
  const [overflow, setOverflow] = useState(0);
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
    // The two moments worth hearing when they happen elsewhere: a load delivered, money in.
    if (fresh.some((e) => e.severity === "success" && /\bpaid\b|payment (in|received)|funded/i.test(e.message))) chime("paid");
    else if (fresh.some((e) => e.type === "delivered")) chime("delivered");
    if (fresh.length > MAX_VISIBLE) setOverflow((n) => n + fresh.length - MAX_VISIBLE);

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

  // Pausing while the pointer is on them: nothing disappears while it's being read.
  function hold() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
  }
  function resume() {
    toasts.forEach((t) => schedule(t.id));
  }

  if (toasts.length === 0 && overflow === 0) return null;

  return (
    <div
      aria-live="polite"
      onMouseEnter={hold}
      onMouseLeave={resume}
      className="pointer-events-none fixed bottom-[5.5rem] right-4 z-[60] flex flex-col items-end gap-2 lg:bottom-6 lg:right-6"
    >
      <AnimatePresence initial={false}>
      {toasts.map((t) => {
        const Icon = TYPE_ICON[t.type];
        const href = hrefFor?.(t);
        const inner = (
          <div className="pointer-events-auto flex w-[19rem] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-xl">
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
        return (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            {href ? (
              <Link href={href} onClick={() => dismiss(t.id)}>
                {inner}
              </Link>
            ) : (
              inner
            )}
          </motion.div>
        );
      })}
      </AnimatePresence>
      {overflow > 0 && (
        <button
          type="button"
          onClick={() => {
            setOverflow(0);
            openBell();
          }}
          className="pointer-events-auto rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-700 shadow-md hover:text-ink-950"
        >
          {overflow} more in alerts
        </button>
      )}
    </div>
  );
}
