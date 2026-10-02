"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

/**
 * Large titles, the iPhone way: each page opens with its name big, and once it scrolls up under the top bar the
 * name shows small in the bar instead, so you always know where you are.
 */

let compact: string | null = null;
const listeners = new Set<() => void>();
const set = (next: string | null) => {
  if (next === compact) return;
  compact = next;
  listeners.forEach((l) => l());
};

export function useCompactTitle(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => compact,
    () => null,
  );
}

/** Watches a page's big title; `offset` is the height of the bar it slides under. */
export function useLargeTitle(ref: RefObject<HTMLElement | null>, title: string, offset = 64) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => set(entry.isIntersecting ? null : title), { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 });
    io.observe(el);
    return () => {
      io.disconnect();
      set(null);
    };
  }, [ref, title, offset]);
}
