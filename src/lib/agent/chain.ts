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
const LINED = new Set<Load["stage"]>(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery"]);
const pickupTime = (l: Load) => Date.parse(l.pickupAt ?? "") || Number.MAX_SAFE_INTEGER;

/** The truck's loads in order: the one it's on first, then the rest by pickup time. */
export function chainOf(loads: Load[], truck: Pick<Truck, "id" | "currentLoadId">): Load[] {
  const mine = loads.filter((l) => l.truckId === truck.id && LINED.has(l.stage));
  const current = mine.find((l) => l.id === truck.currentLoadId);
  const rest = mine.filter((l) => l !== current).sort((a, b) => pickupTime(a) - pickupTime(b));
  return current ? [current, ...rest] : rest;
}

/** Where the truck ends up after everything lined up, and when (null when the last load has no delivery time). */
export function freeAfter(loads: Load[], truck: Truck): { city: string; state: string; at: number | null; lined: number } {
  const chain = chainOf(loads, truck);
  const last = chain[chain.length - 1];
  if (!last) return { city: truck.currentCity, state: truck.currentState, at: null, lined: 0 };
  return { city: last.lane.destination, state: last.lane.destState, at: last.deliveryAt ? Date.parse(last.deliveryAt) + 2 * HOUR : null, lined: chain.length };
}

/** The truck's current and next load from its chain, after a load is booked, delivered or dropped. */
export function slotsFor(loads: Load[], truck: Truck): Pick<Truck, "currentLoadId" | "nextLoadId" | "status"> {
  const chain = chainOf(loads, truck);
  const rolling = chain.find((l) => l.id === truck.currentLoadId);
  const current = rolling ?? chain[0] ?? null;
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
