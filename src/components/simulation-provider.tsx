"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { inDemo } from "@/lib/cloud/demo";

/**
 * Runs the AI dispatcher in the browser. In the demo (no keys, or a tab opened from /demo) it always runs on the
 * sample fleet. For a real account it runs only in the office's session (owner or dispatcher) once their carrier
 * has loaded; a driver's phone just shows and answers.
 */
export function SimulationProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let seedTimeout: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = (seed: boolean) => {
      if (interval) return;
      if (seed) seedTimeout = setTimeout(() => useStore.getState().actions.seedInitialOffers(), 1200);
      interval = setInterval(() => useStore.getState().actions.tick(), 4200);
    };
    const stop = () => {
      clearTimeout(seedTimeout);
      clearInterval(interval);
      interval = undefined;
    };

    if (inDemo()) {
      start(true);
      return stop;
    }
    const follow = () => {
      const { mode, fresh } = useStore.getState().session;
      if (mode === "office") start(!!fresh);
      else stop();
    };
    follow();
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.session !== prev.session) follow();
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  return <>{children}</>;
}
