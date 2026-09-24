"use client";

import { Home } from "lucide-react";
import { useNow } from "@/lib/hooks";
import { formatHours, homeTimeStatus, type HomeTimeStatus } from "@/lib/home";
import { cn } from "@/lib/utils";
import type { Driver, Load, Truck } from "@/lib/types";

/** Where the truck will be empty next: where the current load delivers, or where it's sitting now. */
export function emptiesAt(truck: Truck, current: Load | undefined): { city: string; state: string } {
  return current ? { city: current.lane.destination, state: current.lane.destState } : { city: truck.currentCity, state: truck.currentState };
}

/** Home-time status against the viewer's clock; null until mounted. */
export function useHomeTime(driver: Driver | undefined, truck: Truck | undefined, current: Load | undefined): HomeTimeStatus | null {
  const now = useNow();
  if (!driver || !truck || now === null) return null;
  const at = emptiesAt(truck, current);
  return homeTimeStatus(driver, at.city, at.state, new Date(now));
}

const TITLE: Record<HomeTimeStatus["state"], (target: string) => string> = {
  home: () => "You'll empty out near home",
  on_track: (t) => `${t}: on track`,
  head_home: (t) => `${t}: time to head home`,
  late: (t) => `${t}: at risk`,
  no_target: () => "Home time",
};

export function homeTimeLine(status: HomeTimeStatus, viewer: "driver" | "carrier"): string {
  const away = status.hoursHome !== null ? `about ${formatHours(status.hoursHome)} of driving from ${status.homeCity}` : `away from ${status.homeCity}`;
  const you = viewer === "driver" ? "you're" : "they're";
  switch (status.state) {
    case "home":
      return `The AI looks for short hauls that ${viewer === "driver" ? "get you" : "get them"} home at night.`;
    case "on_track":
      return `After this load ${you} ${away}. There's time, so the AI books the best-paying loads.`;
    case "head_home":
      return `After this load ${you} ${away}. The AI is only booking loads that come closer to home now.`;
    case "late":
      return `Straight home is ${away}. The AI is booking toward home${viewer === "driver" ? " and your carrier can see this" : ""}.`;
    case "no_target":
      return `After this load ${you} ${away}.${viewer === "driver" ? " Set a home-time day in Profile and the AI works around it." : ""}`;
  }
}

/** The driver's home-time card: the one question a dispatcher answers before every load. */
export function HomeTimeCard({ status }: { status: HomeTimeStatus }) {
  const tone = status.state === "late" ? "warn" : status.state === "head_home" ? "info" : "calm";
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3.5", tone === "warn" ? "border-[var(--accent-warn)]/40 bg-amber-50/60" : "border-line")}>
      <Home className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warn" ? "text-[var(--accent-warn)]" : tone === "info" ? "text-[var(--accent-info)]" : "text-ink-400")} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-950">{TITLE[status.state](status.target ?? "Home time")}</p>
        <p className="mt-0.5 text-xs text-ink-500">{homeTimeLine(status, "driver")}</p>
      </div>
    </div>
  );
}
