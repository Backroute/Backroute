"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { haptic } from "@/lib/feedback";
import { refresh } from "@/lib/cloud/sync";
import { cn } from "@/lib/utils";

const PULL = 72;
const MAX = 120;

/**
 * Pull down at the top of a page to get the latest, like every phone app: saves anything waiting and reads it all
 * again. Touch only, and never from a map, a sheet or a sideways swipe.
 */
export function PullToRefresh({ onRefresh }: { onRefresh?: () => Promise<unknown> }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useRef<{ x: number; y: number; active: boolean; armed: boolean } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const start = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || window.scrollY > 0) return;
      // A sheet or menu is open, or the finger is on something that drags on its own.
      if (document.body.style.overflow === "hidden") return;
      const target = e.target as Element | null;
      if (target?.closest(".maplibregl-map, [role=dialog], [data-no-pull], input, textarea, select")) return;
      state.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false, armed: false };
    };
    const move = (e: TouchEvent) => {
      const s = state.current;
      if (!s) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!s.active) {
        if (Math.abs(dx) > Math.abs(dy) || dy <= 6 || window.scrollY > 0) {
          if (Math.abs(dx) > 10 || dy < -6) state.current = null;
          return;
        }
        s.active = true;
      }
      if (e.cancelable) e.preventDefault();
      // Resistance: the further it goes, the harder it pulls.
      const d = Math.min(MAX, dy * 0.5);
      if (d >= PULL && !s.armed) haptic("tap");
      s.armed = d >= PULL;
      setPull(d);
    };
    const end = async () => {
      const s = state.current;
      state.current = null;
      if (!s?.active) return;
      if (!s.armed) {
        setPull(0);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setPull(PULL * 0.75);
      const started = Date.now();
      try {
        await (onRefresh ? onRefresh() : refresh());
      } catch {
        // Offline: what's on screen stays, and saving catches up on its own.
      }
      // Long enough to see it happened.
      await new Promise((r) => setTimeout(r, Math.max(0, 500 - (Date.now() - started))));
      busyRef.current = false;
      setBusy(false);
      setPull(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [onRefresh]);

  if (!pull && !busy) return null;
  const ready = pull >= PULL;
  return (
    <div
      role="status"
      aria-label={busy ? "Refreshing" : ready ? "Let go to refresh" : "Pull to refresh"}
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center"
      style={{ transform: `translateY(${pull - 28}px)`, transition: busy ? "transform 200ms ease" : "none" }}
    >
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white shadow-lg", ready || busy ? "text-brand" : "text-ink-400")}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowDown className="h-4 w-4 transition-transform" style={{ transform: `rotate(${ready ? 180 : (pull / PULL) * 180}deg)`, opacity: Math.min(1, pull / 40) }} />
        )}
      </span>
    </div>
  );
}
