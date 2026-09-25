import type { Load } from "./types";

/** Standard broker terms: two hours free at each stop, then detention by the hour. */
export const DETENTION_FREE_MIN = 120;
export const DETENTION_RATE_HR = 75;
/** Demo pacing, like the trip legs: every real second at the dock counts as five minutes, so free time runs out
 *  in 24 seconds instead of two hours. */
export const DOCK_MINUTES_PER_SEC = 5;

const SESSION_START = typeof window === "undefined" ? 0 : Date.now();

// The demo's sped-up dock clock; a real account switches to real time when it loads (lib/cloud/sync).
let minutesPerSecond = DOCK_MINUTES_PER_SEC;
export function switchToRealDockClock() {
  minutesPerSecond = 1 / 60;
}

export type DockStop = "pickup" | "delivery";

export interface DockClock {
  stop: DockStop;
  minutes: number;
  freeLeft: number;
  /** Detention earned so far, in dollars. */
  owed: number;
  /** Still at the dock (not loaded / unloaded yet). */
  running: boolean;
}

export function detentionFor(minutes: number): number {
  return Math.round((Math.max(0, minutes - DETENTION_FREE_MIN) / 60) * DETENTION_RATE_HR);
}

/** How long the truck has been (or was) at a stop's dock. Loads that were already sitting at a dock when the app
 *  opened start their clock at session start rather than at a seeded timestamp from before the demo began. */
export function dockMinutes(load: Load, stop: DockStop, now: number): number | null {
  const c = load.tripChecklist;
  const arrived = stop === "pickup" ? c?.arrivedPickupAt : c?.arrivedDeliveryAt;
  const atStop = load.stage === (stop === "pickup" ? "at_pickup" : "at_delivery");
  if (!arrived && !atStop) return null;
  const start = arrived ? Date.parse(arrived) : SESSION_START;
  const endIso = stop === "pickup" ? c?.loadedAt : c?.unloadedAt;
  const end = endIso ? Date.parse(endIso) : now;
  return Math.max(0, Math.round(((end - start) / 1000) * minutesPerSecond));
}

/** The dock clock for whichever stop the truck is sitting at right now, or null when it's on the road. */
export function dockClock(load: Load, now: number | null): DockClock | null {
  if (now === null) return null;
  const stop: DockStop | null = load.stage === "at_pickup" ? "pickup" : load.stage === "at_delivery" ? "delivery" : null;
  if (!stop) return null;
  const minutes = dockMinutes(load, stop, now) ?? 0;
  const done = !!(stop === "pickup" ? load.tripChecklist?.loadedAt : load.tripChecklist?.unloadedAt);
  return { stop, minutes, freeLeft: Math.max(0, DETENTION_FREE_MIN - minutes), owed: detentionFor(minutes), running: !done };
}

export function formatDockTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
