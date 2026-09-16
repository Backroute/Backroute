"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().actions.tick();
    }, 4200);
    return () => clearInterval(id);
  }, []);

  return <>{children}</>;
}
