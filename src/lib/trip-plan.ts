import { roadMiles, roughCoords } from "./trip-geo";
import type { Load, LoadStage, Truck, TripStop } from "./types";

/**
 * Several partial loads on one truck, the way dispatchers build a run out of LTL-sized freight: pick up two or three
 * in one area, drop them along the way, pick up more on the road. Each load keeps its own broker, rate con and
 * invoice; the trip is only the order of the stops.
 *
 * The order is worked out stop by stop: every pickup before its drop, the trailer never over its feet or its weight,
 * each appointment made (an hour's grace), and 10 hours off after 11 of driving. Freight that can't ride together
 * doesn't: hazmat with food, reefer loads set more than 2°F apart, a load the shipper wants the trailer to itself for.
 * The order that drives the fewest miles wins; one that makes a load come off from behind another (a restack at the
 * dock) counts as 30 miles more, and the driver hears about any that's left.
 */

const HOUR = 3600_000;
const MPH = 50;
/** Hours at each dock, loading or unloading a partial. */
const DOCK_HOURS = 1.5;
/** How late a truck can be for an appointment and still have it (most docks give some grace). */
const GRACE = 1 * HOUR;
const RESTACK_MILES = 30;
/** Loads on one trip, at most: past that, stops pile up and every one late makes the rest late. */
export const TRIP_MAX = 8;
const FULL_FEET = 53;
/** A standard 48x40 pallet takes about 2 feet of a 53-foot trailer, loaded two across (26 to a trailer). */
const FEET_PER_PALLET = FULL_FEET / 26;
/** A partial whose size the broker didn't give is planned as half the trailer, to be safe. */
const UNKNOWN_PARTIAL_FEET = 26;

/** What a load carries into the plan. */
export type TripLoad = Pick<Load, "id" | "referenceNumber" | "lane" | "equipmentType" | "weight"> &
  Partial<Pick<Load, "pickupAt" | "deliveryAt" | "partial" | "exclusive" | "hazmat" | "commodity" | "rateConReading" | "stage">>;

export const isPartial = (l: Pick<Load, "partial">) => !!l.partial;

/** The trailer: its own size when the owner gave it, else a 53-footer (a 48-foot flatbed) rated for 44,000 lbs. */
export function trailerOf(truck: Pick<Truck, "trailer" | "equipmentType">): { feet: number; lbs: number } {
  return { feet: truck.trailer?.feet ?? (truck.equipmentType === "Flatbed" ? 48 : FULL_FEET), lbs: truck.trailer?.payloadLbs ?? 44_000 };
}

/** Feet of trailer a load takes: what the broker said, else its pallets, else all of it (a full load). */
export function loadFeet(l: Pick<Load, "partial">): number {
  if (!l.partial) return FULL_FEET;
  if (l.partial.feet) return l.partial.feet;
  if (l.partial.pallets) return Math.ceil(l.partial.pallets * FEET_PER_PALLET);
  return UNKNOWN_PARTIAL_FEET;
}

/** The share of a full load's price a partial is worth: its feet of the trailer, never under about a third. */
export function partialShare(l: Pick<Load, "partial">): number {
  return l.partial ? Math.min(1, Math.max(0.35, loadFeet(l) / FULL_FEET)) : 1;
}

const FOOD = /\b(food|foods|produce|meat|poultry|beef|pork|chicken|seafood|fish|dairy|cheese|milk|eggs?|frozen|bever|juice|grocer|candy|bakery|bread|snacks?|fruit|vegetables?|cereal|pet food|feed)\b/i;
const tempOf = (l: TripLoad): number | null => {
  const set = l.rateConReading?.reefer?.setF;
  if (typeof set === "number") return set;
  const m = l.commodity?.match(/(-?\d{1,2})\s*°?\s*F\b/i);
  return m ? Number(m[1]) : null;
};

/** Why two loads can't share the trailer, or null when they can. */
export function cantShare(a: TripLoad, b: TripLoad): string | null {
  if (!isPartial(a) || !isPartial(b)) return "a full load takes the whole trailer";
  if (a.exclusive || b.exclusive) return `${(a.exclusive ? a : b).referenceNumber} has the trailer to itself`;
  if (a.equipmentType !== b.equipmentType) return "different trailers";
  const food = (l: TripLoad) => FOOD.test(l.commodity ?? "");
  if ((a.hazmat && food(b)) || (b.hazmat && food(a))) return "hazmat can't ride with food";
  if (a.equipmentType === "Reefer") {
    const ta = tempOf(a);
    const tb = tempOf(b);
    if (ta !== null && tb !== null && Math.abs(ta - tb) > 2) return `set ${ta}°F and ${tb}°F`;
  }
  return null;
}

/** Done means the truck is past that stop: loaded and gone for a pickup, delivered for a drop. */
const PAST_PICKUP = new Set<LoadStage>(["in_transit", "at_delivery", "delivered"]);
export function stopDone(l: Pick<Load, "stage"> | undefined, kind: TripStop["kind"]): boolean {
  if (!l) return true;
  if (l.stage === "cancelled" || l.stage === "declined") return true;
  return kind === "pickup" ? PAST_PICKUP.has(l.stage) : l.stage === "delivered";
}

/** The trip's stops with their loads, in order, and which are behind the truck. Stops of a cancelled load drop off. */
export function tripStops(truck: Pick<Truck, "trip">, loads: Load[]): { stop: TripStop; load: Load; done: boolean }[] {
  if (!truck.trip) return [];
  const byId = new Map(loads.map((l) => [l.id, l]));
  return truck.trip.stops
    .map((stop) => ({ stop, load: byId.get(stop.loadId)! }))
    .filter((s) => s.load && s.load.stage !== "cancelled" && s.load.stage !== "declined")
    .map((s) => ({ ...s, done: stopDone(s.load, s.stop.kind) }));
}

/** The stop the truck is heading to now, and where it is in the trip (1-based). Null with no trip or all done. */
export function nextStop(truck: Pick<Truck, "trip">, loads: Load[]): { stop: TripStop; load: Load; index: number; total: number } | null {
  const stops = tripStops(truck, loads);
  const i = stops.findIndex((s) => !s.done);
  return i < 0 ? null : { stop: stops[i].stop, load: stops[i].load, index: i + 1, total: stops.length };
}

/** The loads on the truck's trip that still have a stop to make. */
export function tripLoads(truck: Pick<Truck, "trip">, loads: Load[]): Load[] {
  const seen = new Set<string>();
  const out: Load[] = [];
  for (const s of tripStops(truck, loads)) {
    if (s.done || seen.has(s.load.id)) continue;
    seen.add(s.load.id);
    out.push(s.load);
  }
  return out;
}

/** Where the plan starts: where the truck is, when, how much driving it has left, and what's already on it. */
export interface TripStart {
  at: [number, number] | null;
  time: number;
  /** Hours of driving left before the 10-hour break (the ELD's clock, else a full 11). */
  driveLeft?: number;
  /** Loads already in the trailer, in the order they went on (first is deepest, by the nose). */
  onboard?: TripLoad[];
}

export interface TripRun {
  ok: boolean;
  /** Why it can't be run, when it can't. */
  why?: string;
  miles: number;
  /** When the truck gets to each stop. */
  etas: number[];
  /** Loads that have to be moved to get another out. */
  restacks: { at: string; out: string; blocking: string[] }[];
}

const placeOf = (l: TripLoad, kind: TripStop["kind"]) => (kind === "pickup" ? { city: l.lane.origin, state: l.lane.originState } : { city: l.lane.destination, state: l.lane.destState });
const timeOf = (l: TripLoad, kind: TripStop["kind"]) => Date.parse((kind === "pickup" ? l.pickupAt : l.deliveryAt) ?? "") || null;

/** Drives the stops in order and says whether it works: precedence, space, weight, appointments, hours. */
export function runTrip(order: TripStop[], loads: Map<string, TripLoad>, start: TripStart, trailer: { feet: number; lbs: number }, opts: { etasOnly?: boolean } = {}): TripRun {
  let at = start.at;
  let time = start.time;
  let driveLeft = start.driveLeft ?? 11;
  let miles = 0;
  const onboard = [...(start.onboard ?? [])];
  const etas: number[] = [];
  const restacks: TripRun["restacks"] = [];
  const fail = (why: string): TripRun => ({ ok: false, why, miles, etas, restacks });
  for (const s of order) {
    const l = loads.get(s.loadId);
    if (!l) return fail("a load on the trip is gone");
    const p = placeOf(l, s.kind);
    const here = roughCoords(p.city, p.state)?.at ?? null;
    const leg = at && here ? roadMiles(at, here) : 0;
    miles += leg;
    let hours = leg / MPH;
    // Ten hours off once the eleven are used up, partway down the road if need be.
    while (hours > driveLeft) {
      time += driveLeft * HOUR + 10 * HOUR;
      hours -= driveLeft;
      driveLeft = 11;
    }
    time += hours * HOUR;
    driveLeft -= hours;
    if (here) at = here;
    etas.push(time);
    const appt = timeOf(l, s.kind);
    if (appt && time > appt + GRACE && !opts.etasOnly) return fail(`${l.referenceNumber} ${s.kind === "pickup" ? "pickup" : "delivery"} in ${p.city} would be missed`);
    if (appt && time < appt) {
      // Waiting on the appointment; a long enough wait is the driver's break.
      if (appt - time >= 10 * HOUR) driveLeft = 11;
      time = appt;
    }
    time += DOCK_HOURS * HOUR;
    // Only when the truck gets where (late or not): what's on the trailer isn't checked.
    if (opts.etasOnly) continue;
    if (s.kind === "pickup") {
      if (onboard.some((o) => o.id === l.id)) return fail(`${l.referenceNumber} is picked up twice`);
      for (const o of onboard) {
        const why = cantShare(o, l);
        if (why) return fail(`${l.referenceNumber} can't ride with ${o.referenceNumber}: ${why}`);
      }
      onboard.push(l);
      const feet = onboard.reduce((n, o) => n + loadFeet(o), 0);
      const lbs = onboard.reduce((n, o) => n + (o.weight || 0), 0);
      if (feet > trailer.feet) return fail(`no room for ${l.referenceNumber} in ${p.city}: ${feet} ft of ${trailer.feet}`);
      if (lbs > trailer.lbs) return fail(`too heavy with ${l.referenceNumber} in ${p.city}: ${lbs.toLocaleString("en-US")} lbs`);
    } else {
      const i = onboard.findIndex((o) => o.id === l.id);
      if (i < 0) return fail(`${l.referenceNumber} is dropped before it's picked up`);
      // Freight loaded after this one sits between it and the doors.
      const blocking = onboard.slice(i + 1).map((o) => o.referenceNumber);
      if (blocking.length) restacks.push({ at: p.city, out: l.referenceNumber, blocking });
      onboard.splice(i, 1);
    }
  }
  return { ok: true, miles: Math.round(miles), etas, restacks };
}

const cost = (r: TripRun) => r.miles + r.restacks.length * RESTACK_MILES;

/** The best places for a load's pickup and drop in an order that stays as it is otherwise. Null: nowhere works. */
export function insertLoad(order: TripStop[], load: TripLoad, loads: Map<string, TripLoad>, start: TripStart, trailer: { feet: number; lbs: number }): { order: TripStop[]; run: TripRun } | null {
  const all = new Map(loads).set(load.id, load);
  let best: { order: TripStop[]; run: TripRun } | null = null;
  for (let i = 0; i <= order.length; i++) {
    for (let j = i; j <= order.length; j++) {
      const next = [...order.slice(0, i), { loadId: load.id, kind: "pickup" as const }, ...order.slice(i, j), { loadId: load.id, kind: "delivery" as const }, ...order.slice(j)];
      const run = runTrip(next, all, start, trailer);
      if (run.ok && (!best || cost(run) < cost(best.run))) best = { order: next, run };
    }
  }
  return best;
}

/**
 * The order for a set of loads from scratch: each put in where it adds the least (earliest pickup first), then each
 * taken out and put back where it fits best while that keeps saving miles. Loads already on board only have their
 * drop to make. Null when they can't all be run together.
 */
export function planTrip(loads: TripLoad[], start: TripStart, trailer: { feet: number; lbs: number }): { order: TripStop[]; run: TripRun } | null {
  if (loads.length > TRIP_MAX) return null;
  const onboard = new Set((start.onboard ?? []).map((l) => l.id));
  const byId = new Map(loads.map((l) => [l.id, l]));
  for (const l of start.onboard ?? []) byId.set(l.id, l);
  let order: TripStop[] = [];
  // Drops for what's already on: in the cheapest order they fit, one by one.
  for (const l of loads.filter((x) => onboard.has(x.id))) {
    let best: TripStop[] | null = null;
    let bestRun: TripRun | null = null;
    for (let j = 0; j <= order.length; j++) {
      const next = [...order.slice(0, j), { loadId: l.id, kind: "delivery" as const }, ...order.slice(j)];
      const run = runTrip(next, byId, start, trailer);
      if (run.ok && (!bestRun || cost(run) < cost(bestRun))) {
        best = next;
        bestRun = run;
      }
    }
    if (!best) return null;
    order = best;
  }
  const rest = loads.filter((x) => !onboard.has(x.id)).sort((a, b) => (Date.parse(a.pickupAt ?? "") || Infinity) - (Date.parse(b.pickupAt ?? "") || Infinity));
  for (const l of rest) {
    const placed = insertLoad(order, l, byId, start, trailer);
    if (!placed) return null;
    order = placed.order;
  }
  let run = runTrip(order, byId, start, trailer);
  // Better places, one load at a time, until nothing saves anything (a few passes is plenty for eight loads).
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const l of rest) {
      const without = order.filter((s) => s.loadId !== l.id);
      const placed = insertLoad(without, l, byId, start, trailer);
      if (placed && cost(placed.run) < cost(run) - 0.5) {
        order = placed.order;
        run = placed.run;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return run.ok ? { order, run } : null;
}

/** The order's restacks, in the driver's words. */
export function restackNotes(run: TripRun): string[] {
  return run.restacks.map((r) => `At ${r.at}, ${r.blocking.join(" and ")} ${r.blocking.length === 1 ? "is" : "are"} in front of ${r.out}: ask the shipper to load ${r.out} by the doors if there's room, or be ready to move ${r.blocking.length === 1 ? "it" : "them"} at the drop.`);
}

/**
 * After a load moves a stage: the load the truck is working on is the one at its next stop. Null when the trip has no
 * stop left (the truck goes on to whatever is lined up after it).
 */
export function tripCurrent(truck: Pick<Truck, "trip">, loads: Load[]): string | null {
  return nextStop(truck, loads)?.load.id ?? null;
}
