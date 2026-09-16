"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const seedTimeout = setTimeout(() => {
      useStore.getState().actions.seedInitialOffers();
    }, 1200);
    const id = setInterval(() => {
      useStore.getState().actions.tick();
    }, 4200);
    return () => {
      clearTimeout(seedTimeout);
      clearInterval(id);
    };
  }, []);

  return <>{children}</>;
}
