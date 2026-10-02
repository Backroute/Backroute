"use client";

import { useEffect } from "react";

/**
 * The number on the app's icon once it's added to the home screen or dock (Badging API: Chrome, Edge, Safari on
 * installed web apps). Cleared at zero; does nothing where it isn't supported.
 */
export function useAppBadge(count: number) {
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    (count > 0 ? nav.setAppBadge(count) : (nav.clearAppBadge?.() ?? Promise.resolve())).catch(() => {});
  }, [count]);
}
