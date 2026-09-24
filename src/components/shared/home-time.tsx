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

function title(status: HomeTimeStatus): string {
  const t = status.target ?? "Home time";
  if (status.runType === "local" || status.runType === "intown") {
    return { home: "Home tonight: this load ends near home", on_track: "Home tonight: on track", head_home: "Home tonight: last load of the day", late: "Home tonight: at risk", no_target: "Home tonight" }[status.state];
  }
  return { home: "You'll empty out near home", on_track: `${t}: on track`, head_home: `${t}: time to head home`, late: `${t}: at risk`, no_target: "Home time" }[status.state];
}

export function homeTimeLine(status: HomeTimeStatus, viewer: "driver" | "carrier"): string {
  const away =
    status.hoursHome === null
      ? `away from ${status.homeCity}`
      : status.hoursHome < 1
        ? `under an hour from ${status.homeCity}`
        : `about ${formatHours(status.hoursHome)} of driving from ${status.homeCity}`;
  const you = viewer === "driver" ? "you're" : "they're";
  const yours = viewer === "driver" ? "you have" : "they have";
  if (status.runType === "local" || status.runType === "intown") {
    const left = status.hoursLeftToday !== undefined ? `${formatHours(status.hoursLeftToday)} of driving left today` : "";
    switch (status.state) {
      case "home":
      case "on_track":
        return `After this load ${you} ${away}, and ${yours} ${left}. Room for another ${status.runType === "intown" ? "move" : "local run"}.`;
      case "head_home":
        return `After this load ${you} ${away} with ${left}. The AI only books a ${status.runType === "intown" ? "move" : "run"} that ends near home.`;
      case "late":
        return `Not enough hours left today to get home: ${away}, ${left}.${viewer === "driver" ? " Your carrier can see this." : ""}`;
      case "no_target":
        return left ? `${yours[0].toUpperCase()}${yours.slice(1)} ${left}.` : "";
    }
  }
  switch (status.state) {
    case "home":
      return status.runType === "otr"
        ? "Empties near home. The AI books the next run out, or a load close by if a home day is due."
        : `Empties near home. The AI keeps the next loads inside ${viewer === "driver" ? "your" : "their"} region.`;
    case "on_track":
      return `After this load ${you} ${away}. There's time, so the AI books the best-paying loads.`;
    case "head_home":
      return `After this load ${you} ${away}. The AI is only booking loads that come closer to home now.`;
    case "late":
      return `Straight home is ${away}. The AI is booking toward home${viewer === "driver" ? " and your carrier can see this" : ""}.`;
    case "no_target":
      return `After this load ${you} ${away}.${viewer === "driver" ? " Set a home-time goal in Profile and the AI works around it." : ""}`;
  }
}

/** The driver's home-time card: the one question a dispatcher answers before every load. */
export { title as homeTimeTitle };

export function HomeTimeCard({ status }: { status: HomeTimeStatus }) {
  const tone = status.state === "late" ? "warn" : status.state === "head_home" ? "info" : "calm";
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3.5", tone === "warn" ? "border-[var(--accent-warn)]/40 bg-amber-50/60" : "border-line")}>
      <Home className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warn" ? "text-[var(--accent-warn)]" : tone === "info" ? "text-[var(--accent-info)]" : "text-ink-400")} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-950">{title(status)}</p>
        <p className="mt-0.5 text-xs text-ink-500">{homeTimeLine(status, "driver")}</p>
      </div>
    </div>
  );
}
