"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { inDemo } from "@/lib/cloud/demo";

/**
 * Runs the simulated dispatcher on the sample fleet: in the demo (no keys, or a tab opened from /demo) only. A real
 * account never runs it: its loads, texts, calls and emails are real, and the AI that handles them runs on the
 * server (lib/agent).
 */
export function SimulationProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!inDemo()) return;
    const seedTimeout = setTimeout(() => useStore.getState().actions.seedInitialOffers(), 1200);
    const interval = setInterval(() => useStore.getState().actions.tick(), 4200);
    return () => {
      clearTimeout(seedTimeout);
      clearInterval(interval);
    };
  }, []);

  return <>{children}</>;
}
