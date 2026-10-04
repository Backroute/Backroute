"use client";

import { useEffect, useRef } from "react";
import { Timer } from "lucide-react";
import { useNow } from "@/lib/hooks";
import { clockWords, hosNow, minutesLeft, warningDue, warningWords } from "@/lib/hos-clock";
import { say } from "@/lib/speech";
import { haptic } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import type { Driver } from "@/lib/types";

/**
 * The hours clock, on screen while on duty: drive time left (and the shift's, when it's the one that runs out first),
 * amber under an hour, red under 30 minutes. While driving, a voice says it at an hour, 30 and 15 minutes left, once
 * each, so eyes stay on the road.
 */
export function HosClock({ driver }: { driver: Driver }) {
  const now = useNow();
  const h = now !== null ? hosNow(driver, now) : null;
  useHosVoice(driver, h);
  // Off duty, the clock isn't running: nothing to watch, so nothing on screen.
  if (!h || driver.hosStatus === "off_duty") return null;
  const m = minutesLeft(h);
  const shiftFirst = h.shift < h.drive;
  return (
    <span
      role="timer"
      aria-label={`${clockWords(h.drive)} drive time left, ${clockWords(h.shift)} on your shift`}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular",
        m <= 30 ? "bg-danger-soft text-[var(--accent-danger)]" : m <= 60 ? "bg-warn-soft text-[var(--accent-warn)]" : "bg-ink-100 text-ink-800",
      )}
    >
      <Timer className="h-3.5 w-3.5" />
      {shiftFirst ? `Shift ${clockWords(h.shift)}` : `Drive ${clockWords(h.drive)}`}
    </span>
  );
}

const SPOKEN_KEY = "backroute.hosSpoken";

function useHosVoice(driver: Driver, h: ReturnType<typeof hosNow> | null) {
  const last = useRef<string | null>(null);
  const due = h && h.driving && driver.prefs?.hosVoice !== false ? warningDue(h) : null;
  // One heads-up per threshold per duty day (the ELD reading's day keeps it from repeating after a reload).
  const key = due && h ? `${driver.id}:${driver.hos?.at.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}:${due}` : null;
  useEffect(() => {
    if (!key || !h || last.current === key) return;
    last.current = key;
    try {
      if (sessionStorage.getItem(SPOKEN_KEY)?.split(",").includes(key)) return;
      sessionStorage.setItem(SPOKEN_KEY, [...(sessionStorage.getItem(SPOKEN_KEY)?.split(",") ?? []).slice(-10), key].join(","));
    } catch {}
    haptic("warning");
    say(warningWords(minutesLeft(h), h), undefined, { lang: driver.prefs?.language === "es" ? "es-US" : "en-US" });
  }, [key, h, driver.prefs?.language]);
}
