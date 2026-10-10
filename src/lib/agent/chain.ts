import { estimateMiles } from "../fleet";
import { reloadMarket } from "../home";
import { nextStop, tripAhead, tripLoads } from "../trip-plan";
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
 * a forgotten one can't hold up the truck. On a multi-load trip (lib/trip-plan), the load at the trip's next stop is
 * the current one and the trip's other loads follow it, in the order they come off. A trip planned ahead (partials
 * after a full load: the one the truck is on, or one lined up behind it) follows that load.
 */
export function chainOf(loads: Load[], truck: Pick<Truck, "id" | "currentLoadId"> & { nextLoadId?: string | null; trip?: Truck["trip"] }, now = Date.now()): Load[] {
  const onTrip = truck.trip ? tripLoads(truck, loads) : [];
  const tripIds = new Set(onTrip.map((l) => l.id));
  const ahead = tripAhead(truck, loads);
  const stop = truck.trip && !ahead ? nextStop(truck, loads) : null;
  const rolling = loads.find((l) => l.id === truck.currentLoadId && l.truckId === truck.id && ROLLING.has(l.stage));
  // A trip planned ahead waits behind a full load: the one the truck is on, or one lined up after it.
  // (Between the loads before it, the truck's next one moves up like any lineup.)
  const current = ahead ? (rolling && !tripIds.has(rolling.id) ? rolling : undefined) : (stop?.load ?? rolling);
  const dropAt = (l: Load) => truck.trip!.stops.findIndex((s) => s.loadId === l.id && s.kind === "delivery");
  const tripRest = onTrip.filter((l) => l !== current).sort((a, b) => dropAt(a) - dropAt(b));
  const waiting = loads.filter((l) => l !== current && !tripIds.has(l.id) && l.truckId === truck.id && WAITING.has(l.stage) && !(l.pickupAt && Date.parse(l.pickupAt) < now - DAY));
  const next = waiting.find((l) => l.id === truck.nextLoadId);
  const lineup = [...(next ? [next] : []), ...waiting.filter((l) => l !== next).sort((a, b) => pickupTime(a) - pickupTime(b))];
  // The trip's stops come after the load it waits for; on a trip under way, right after the stop the truck is at.
  const cut = ahead && ahead !== current ? lineup.indexOf(ahead) + 1 : 0;
  return [...(current ? [current] : []), ...lineup.slice(0, cut), ...tripRest, ...lineup.slice(cut)];
}

/** The load the truck finishes on: the last lined up, or on a trip with nothing after it, the trip's last drop. */
export function chainEnd(loads: Load[], truck: Truck, now = Date.now()): Load | undefined {
  const chain = chainOf(loads, truck, now);
  const onTrip = truck.trip ? new Set(tripLoads(truck, loads).map((l) => l.id)) : new Set<string>();
  if (!onTrip.size) return chain[chain.length - 1];
  // What's lined up after the trip (the loads before a trip planned ahead aren't after it).
  const lastOnTrip = chain.reduce((at, l, i) => (onTrip.has(l.id) ? i : at), -1);
  const after = chain.slice(lastOnTrip + 1);
  if (after.length) return after[after.length - 1];
  const lastDrop = [...truck.trip!.stops].reverse().find((s) => s.kind === "delivery" && onTrip.has(s.loadId));
  return chain.find((l) => l.id === lastDrop?.loadId) ?? chain[chain.length - 1];
}

/** How many runs the truck has lined up, a whole multi-load trip counting as one (for the three the AI books ahead). */
export function linedUp(loads: Load[], truck: Truck, now = Date.now()): number {
  const chain = chainOf(loads, truck, now);
  const onTrip = truck.trip ? tripLoads(truck, loads).length : 0;
  return onTrip ? chain.length - onTrip + 1 : chain.length;
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
export function freeAfter(loads: Load[], truck: Truck, now = Date.now()): { city: string; state: string; at: number | null; lined: number } {
  const last = chainEnd(loads, truck, now);
  if (!last) return { city: truck.currentCity, state: truck.currentState, at: null, lined: 0 };
  const done = doneAt(last);
  return { city: last.lane.destination, state: last.lane.destState, at: done ? done + 2 * HOUR : null, lined: linedUp(loads, truck, now) };
}

/** The truck's current and next load from its chain, after a load is booked, delivered or dropped. */
export function slotsFor(loads: Load[], truck: Truck, now = Date.now()): Pick<Truck, "currentLoadId" | "nextLoadId" | "status" | "trip"> {
  const chain = chainOf(loads, truck, now);
  const current = chain[0] ?? null;
  // A trip's other loads aren't "next": they're on the truck already. Next is what comes after the trip.
  const onTrip = truck.trip ? new Set(tripLoads(truck, loads).map((l) => l.id)) : new Set<string>();
  // A trip planned ahead right after the load the truck is on: its first pickup is next. Behind more of the lineup,
  // the next booked load is.
  const ahead = tripAhead(truck, loads);
  const next = (ahead && ahead === current ? nextStop(truck, loads)?.load : chain.find((l) => l !== current && !onTrip.has(l.id))) ?? null;
  return {
    currentLoadId: current?.id ?? null,
    nextLoadId: next?.id ?? null,
    status: truck.status === "maintenance" ? "maintenance" : current ? "on_load" : "available",
    // A trip with every stop made is over.
    trip: onTrip.size ? truck.trip : undefined,
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
