import { estimateMiles } from "../fleet";
import { reloadMarket } from "../home";
import type { Load, Truck } from "../types";

/**
 * Loads lined up on a truck, the way a dispatcher keeps a truck's next few days in their head: the one it's on, then
 * what's booked after it, in pickup order. The AI books up to three ahead, each picking up after the one before
 * delivers, so the truck rolls from load to load instead of sitting empty while the AI looks.
 */

export const LINED_UP_MAX = 3;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ROLLING = new Set<Load["stage"]>(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery"]);
/** Booked but not started: what can wait behind the load the truck is on. */
const WAITING = new Set<Load["stage"]>(["rate_confirmed", "booked"]);
const pickupTime = (l: Load) => Date.parse(l.pickupAt ?? "") || Number.MAX_SAFE_INTEGER;

/**
 * The truck's loads in order: the one it's on (its current load), then its next one, then the rest of what's booked
 * by pickup time. A booked load whose pickup is more than a day gone (never started, never cancelled) is left out, so
 * a forgotten one can't hold up the truck.
 */
export function chainOf(loads: Load[], truck: Pick<Truck, "id" | "currentLoadId"> & { nextLoadId?: string | null }, now = Date.now()): Load[] {
  const current = loads.find((l) => l.id === truck.currentLoadId && l.truckId === truck.id && ROLLING.has(l.stage));
  const waiting = loads.filter((l) => l !== current && l.truckId === truck.id && WAITING.has(l.stage) && !(l.pickupAt && Date.parse(l.pickupAt) < now - DAY));
  const next = waiting.find((l) => l.id === truck.nextLoadId);
  const rest = waiting.filter((l) => l !== next).sort((a, b) => pickupTime(a) - pickupTime(b));
  return [...(current ? [current] : []), ...(next ? [next] : []), ...rest];
}

/**
 * When a lined-up load frees the truck: its delivery time, else its pickup plus the drive (about 45 mph with breaks)
 * and two hours at the docks. Null with neither time (a load still waiting on its appointments).
 */
export function doneAt(l: Load): number | null {
  if (l.deliveryAt) return Date.parse(l.deliveryAt);
  if (l.pickupAt) return Date.parse(l.pickupAt) + ((l.lane.miles || 0) / 45 + 2) * HOUR;
  return null;
}

/** Where the truck ends up after everything lined up, and when (null when the last load has no delivery time). */
export function freeAfter(loads: Load[], truck: Truck): { city: string; state: string; at: number | null; lined: number } {
  const chain = chainOf(loads, truck);
  const last = chain[chain.length - 1];
  if (!last) return { city: truck.currentCity, state: truck.currentState, at: null, lined: 0 };
  const done = doneAt(last);
  return { city: last.lane.destination, state: last.lane.destState, at: done ? done + 2 * HOUR : null, lined: chain.length };
}

/** The truck's current and next load from its chain, after a load is booked, delivered or dropped. */
export function slotsFor(loads: Load[], truck: Truck): Pick<Truck, "currentLoadId" | "nextLoadId" | "status"> {
  const chain = chainOf(loads, truck);
  const current = chain[0] ?? null;
  const next = chain.find((l) => l !== current) ?? null;
  return {
    currentLoadId: current?.id ?? null,
    nextLoadId: next?.id ?? null,
    status: truck.status === "maintenance" ? "maintenance" : current ? "on_load" : "available",
  };
}

/**
 * How good a place is to end a load in, from the carrier's own freight: how many loads (of this equipment) were
 * offered out of somewhere within 75 miles in the last three weeks. With little history yet, the built-in market map.
 */
export function reloadOutlook(loads: Load[], city: string, state: string, equipment: Load["equipmentType"], now: number): { count: number; outlook: "strong" | "fair" | "weak" } {
  const recent = loads.filter((l) => Date.parse(l.createdAt ?? l.updatedAt) >= now - 21 * DAY && !l.imported);
  if (recent.length < 10) {
    const outlook = reloadMarket(city, state);
    return { count: outlook === "strong" ? 3 : outlook === "fair" ? 1 : 0, outlook };
  }
  const count = recent.filter((l) => l.equipmentType === equipment && (estimateMiles({ city, state }, { city: l.lane.origin, state: l.lane.originState }) ?? 999) <= 75).length;
  return { count, outlook: count >= 3 ? "strong" : count >= 1 ? "fair" : "weak" };
}

/** What ending in a place is worth next to the load's own profit: about the empty miles it will likely take to reload. */
export function reloadValue(outlook: "strong" | "fair" | "weak"): number {
  return outlook === "strong" ? 0 : outlook === "fair" ? -60 : -150;
}
