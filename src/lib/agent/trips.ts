import "server-only";
import { distanceMiles, roughCoords } from "../trip-geo";
import { insertLoad, isPartial, nextStop, restackNotes, runTrip, stopDone, TRIP_MAX, trailerOf, tripAhead, tripLoads, tripStops, type TripLoad, type TripRun, type TripStart } from "../trip-plan";
import type { Item } from "../cloud/rows";
import type { Load, Truck, TripStop } from "../types";
import { chainOf, doneAt, slotsFor } from "./chain";
import { save, type CarrierContext } from "./db";
import { route, routingConfigured } from "./routing";

/**
 * Partials on the way (lib/trip-plan), for the AI: whether a partial a broker offers fits on a truck's trip, how many
 * miles it adds, and the new order of stops once it's booked.
 */

const HOUR = 3600_000;
const ON_THE_ROAD = new Set<Load["stage"]>(["dispatched", "at_pickup", "in_transit", "at_delivery"]);
const WAITING = new Set<Load["stage"]>(["rate_confirmed", "booked"]);

/** Where the truck starts from now: its ELD spot, else its city; its driving hours left when the ELD knows them. */
function startOf(ctx: Pick<CarrierContext, "drivers">, truck: Truck, onboard: Load[], now: number): TripStart {
  const at: [number, number] | null = truck.position ? [truck.position.lat, truck.position.lon] : (roughCoords(truck.currentCity, truck.currentState)?.at ?? null);
  const driver = ctx.drivers.find((d) => d.id === truck.driverId);
  return { at, time: now, ...(truck.position && driver ? { driveLeft: Math.max(0, Math.min(11, driver.hoursRemaining)) } : {}), onboard };
}

/** Where a trip planned ahead starts: where the full load before it delivers, two hours after its delivery time. */
function aheadStart(full: Load): TripStart | null {
  const done = doneAt(full);
  const at = roughCoords(full.lane.destination, full.lane.destState)?.at ?? null;
  return done && at ? { at, time: done + 2 * HOUR, onboard: [] } : null;
}

/**
 * The trip as it stands: the stops still to make, and the loads on it (a partial the truck is on counts as a trip of
 * one). On a full load, the trip after it (`ahead`): one planned already, or a lone partial booked to follow it that
 * the next partial can join.
 */
function tripNow(ctx: Pick<CarrierContext, "loads">, truck: Truck, now: number): { order: TripStop[]; loads: Load[]; ahead?: Load } | null {
  const planned = tripAhead(truck, ctx.loads);
  if (truck.trip) {
    const left = tripStops(truck, ctx.loads).filter((s) => !s.done);
    if (left.length) return { order: left.map((s) => s.stop), loads: tripLoads(truck, ctx.loads), ...(planned ? { ahead: planned } : {}) };
  }
  const current = ctx.loads.find((l) => l.id === truck.currentLoadId && l.truckId === truck.id && ON_THE_ROAD.has(l.stage));
  if (!current) return { order: [], loads: [] };
  if (!isPartial(current)) {
    // A full load fills the trailer: a trip can only follow it, or follow the last full load lined up after it. It's
    // built on a partial booked last in the lineup (or on the partials the AI is asking for, after the last full load).
    const behind = chainOf(ctx.loads, truck, now).filter((l) => l.id !== current.id);
    if (!behind.length) return { order: [], loads: [], ahead: current };
    const last = behind[behind.length - 1];
    if (!isPartial(last)) return WAITING.has(last.stage) ? { order: [], loads: [], ahead: last } : null;
    const before = behind.length > 1 ? behind[behind.length - 2] : current;
    // Two partials lined up one after the other would already be a trip.
    return WAITING.has(last.stage) && !isPartial(before) ? { order: [{ loadId: last.id, kind: "pickup" }, { loadId: last.id, kind: "delivery" }], loads: [last], ahead: before } : null;
  }
  const order: TripStop[] = [...(stopDone(current, "pickup") ? [] : [{ loadId: current.id, kind: "pickup" as const }]), { loadId: current.id, kind: "delivery" as const }];
  return { order, loads: [current] };
}

export interface TripFit {
  order: TripStop[];
  run: TripRun;
  /** Miles the load adds to the trip beyond its own (negative when it rides along roads the truck drives anyway). */
  extra: number;
  /** The miles the trip adds, all in, for its fuel. */
  added: number;
  /** A trip planned ahead: the full load it starts after (the one the truck is on, or the last one lined up). */
  after?: string;
  /** How it was planned, for measuring it again by road (roadMiles): where it starts, and the stops without the load. */
  start?: TripStart;
  before?: TripStop[];
  loads?: Map<string, TripLoad>;
  /** The miles are truck-road miles (HERE), not the estimate. */
  byRoad?: boolean;
}

/**
 * Whether a partial fits on a truck's trip now: with the loads already on it, and any other partial the AI is asking
 * for on this truck. Null when the truck isn't on a partial run, or the load doesn't fit (space, weight, appointments,
 * hours, freight that can't ride together), or it would make the truck late for what's lined up after the trip.
 */
export function tripFit(ctx: Pick<CarrierContext, "loads" | "drivers">, truck: Truck, load: TripLoad, now = Date.now()): TripFit | null {
  if (!isPartial(load) || load.equipmentType !== truck.equipmentType) return null;
  const trip = tripNow(ctx, truck, now);
  if (!trip) return null;
  // Partials the AI is still asking for on this truck are planned in as if they'll come through.
  const asking = ctx.loads.filter((l) => l.truckId === truck.id && l.stage === "negotiating" && l.id !== load.id && isPartial(l) && !trip.loads.some((x) => x.id === l.id));
  const all = [...trip.loads.filter((l) => l.id !== load.id), ...asking];
  if (!all.length || all.length + 1 > TRIP_MAX) return null;
  const onboard = trip.loads.filter((l) => stopDone(l, "pickup") && !stopDone(l, "delivery"));
  const start = trip.ahead ? aheadStart(trip.ahead) : startOf(ctx, truck, onboard, now);
  if (!start) return null;
  const trailer = trailerOf(truck);
  const byId = new Map<string, TripLoad>(all.map((l) => [l.id, l]));
  let order = trip.order.filter((s) => s.loadId !== load.id);
  for (const l of asking) {
    const placed = insertLoad(order, l, byId, start, trailer);
    if (!placed) return null;
    order = placed.order;
  }
  const before = runTrip(order, byId, start, trailer);
  if (!before.ok && order.length) return null;
  const placed = insertLoad(order, load, byId, start, trailer);
  if (!placed) return null;
  // What's lined up after the trip still has to be made: the last drop, plus two hours, before its pickup.
  const onTrip = new Set([...all.map((l) => l.id), load.id]);
  const chain = chainOf(ctx.loads, truck, now);
  const after = chain.slice(trip.ahead ? chain.indexOf(trip.ahead) + 1 : 0).find((l) => !onTrip.has(l.id) && l !== trip.ahead);
  const end = placed.run.etas[placed.run.etas.length - 1];
  if (after?.pickupAt && end && end + 3.5 * HOUR > Date.parse(after.pickupAt)) return null;
  const added = Math.round(placed.run.miles - (order.length ? before.miles : 0));
  return { order: placed.order, run: placed.run, extra: added - load.lane.miles, added, ...(trip.ahead ? { after: trip.ahead.id } : {}), start, before: order, loads: new Map([...byId, [load.id, load]]) };
}

/** Truck-road miles for stops driven in order from the start, or null when a leg has no route. */
async function legsByRoad(order: TripStop[], loads: Map<string, TripLoad>, start: TripStart): Promise<number | null> {
  let from: { lat: number; lon: number } | { city: string; state: string } | null = start.at ? { lat: start.at[0], lon: start.at[1] } : null;
  let miles = 0;
  for (const s of order) {
    const l = loads.get(s.loadId);
    if (!l) return null;
    const to = s.kind === "pickup" ? { city: l.lane.origin, state: l.lane.originState } : { city: l.lane.destination, state: l.lane.destState };
    // The same town (or the truck already there): no leg to measure, and the routing service has no route for it.
    const fromAt = from && ("lat" in from ? ([from.lat, from.lon] as [number, number]) : roughCoords(from.city, from.state)?.at);
    const toAt = roughCoords(to.city, to.state)?.at;
    const sameSpot = fromAt && toAt ? distanceMiles(fromAt, toAt) < 3 : !!from && "city" in from && from.city === to.city && from.state === to.state;
    if (from && !sameSpot) {
      const r = await route(from, to);
      if (!r) return null;
      miles += r.miles;
    }
    from = to;
  }
  return Math.round(miles);
}

/**
 * The fit measured again by truck road (HERE, truck mode), when routing is set up: the stop order is still chosen on
 * the estimate (it tries many), then the chosen order and the trip without the load are driven by road, so the miles
 * the load adds, its fuel and its profit are road miles. Unchanged without routing, or when a place has no route.
 */
export async function byRoad(fit: TripFit, ownMiles: number): Promise<TripFit> {
  if (!routingConfigured() || !fit.start || !fit.loads || fit.byRoad) return fit;
  const [after, before] = await Promise.all([legsByRoad(fit.order, fit.loads, fit.start), fit.before?.length ? legsByRoad(fit.before, fit.loads, fit.start) : Promise.resolve(0)]);
  if (after === null || before === null) return fit;
  const added = after - before;
  return { ...fit, run: { ...fit.run, miles: after }, added, extra: added - ownMiles, byRoad: true };
}

/** A partial booked onto a free truck starts a trip of one, so the next partial on the way can join it. */
export function newTrip(load: Load): Truck["trip"] {
  return { id: `trip-${load.id}`, stops: [{ loadId: load.id, kind: "pickup" }, { loadId: load.id, kind: "delivery" }], at: new Date().toISOString() };
}

/** The trip once the load is on it: the stops already made stay at the front, so "stop 3 of 8" keeps meaning the same. */
export function tripWith(ctx: Pick<CarrierContext, "loads">, truck: Truck, fit: TripFit): NonNullable<Truck["trip"]> {
  const made = truck.trip ? tripStops(truck, ctx.loads).filter((s) => s.done).map((s) => s.stop) : [];
  // A trip of one made from a partial the truck was already on: its pickup is behind it. (Not the full load before a
  // trip planned ahead.)
  const current = !truck.trip && !fit.after ? ctx.loads.find((l) => l.id === truck.currentLoadId) : undefined;
  const madeHere = current && stopDone(current, "pickup") ? [{ loadId: current.id, kind: "pickup" as const }] : [];
  const notes = restackNotes(fit.run);
  const after = fit.after ?? truck.trip?.after;
  return { id: truck.trip?.id ?? `trip-${truck.id}-${Date.now().toString(36)}`, stops: [...made, ...madeHere, ...fit.order], at: new Date().toISOString(), ...(after ? { after } : {}), ...(notes.length ? { warnings: notes } : {}) };
}

/** Where a load's stops are on the trip, in the driver's words: "stop 3 and stop 6 of 8". */
export function stopsLine(trip: NonNullable<Truck["trip"]>, loadId: string): string {
  const p = trip.stops.findIndex((s) => s.loadId === loadId && s.kind === "pickup") + 1;
  const d = trip.stops.findIndex((s) => s.loadId === loadId && s.kind === "delivery") + 1;
  return `Pick it up at stop ${p} and drop it at stop ${d} of ${trip.stops.length}.`;
}

/** The trip's next stop, in a line for the driver. Null with no trip or no stop left. */
export function nextStopLine(truck: Pick<Truck, "trip">, loads: Load[]): string | null {
  const s = nextStop(truck, loads);
  if (!s) return null;
  const l = s.load;
  return s.stop.kind === "pickup"
    ? `Next stop (${s.index} of ${s.total}): pick up ${l.referenceNumber} in ${l.lane.origin}, ${l.lane.originState}${l.pickupAddress ? ` (${l.pickupAddress})` : ""}, ${l.pickupWindow}.`
    : `Next stop (${s.index} of ${s.total}): drop ${l.referenceNumber} in ${l.lane.destination}, ${l.lane.destState}${l.deliveryAddress ? ` (${l.deliveryAddress})` : ""}, ${l.deliveryWindow}.`;
}

/**
 * After a load on a trip moves a stage (loaded, delivered): the truck works the load at its next stop; with every
 * stop made the trip is over and what's lined up after it moves up. Saved only when something changed.
 */
export async function followTrip(ctx: CarrierContext, truck: Truck): Promise<Truck> {
  if (!truck.trip) return truck;
  const s = slotsFor(ctx.loads, truck);
  if (s.trip && s.currentLoadId === truck.currentLoadId && s.nextLoadId === truck.nextLoadId && s.status === truck.status) return truck;
  const next: Truck = { ...truck, ...s };
  if (!s.trip) delete next.trip;
  await save("trucks", ctx.carrier.id, next as unknown as Item);
  ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? next : t));
  return next;
}

/**
 * When the truck gets to each stop left on its trip, going through the ones before it (key "loadId:pickup" or
 * "loadId:delivery"). Null without a trip or a fresh ELD position: a guess from the city isn't enough to call a stop late.
 */
export function tripEtas(ctx: Pick<CarrierContext, "loads" | "drivers">, truck: Truck, now: number): Map<string, number> | null {
  // A trip planned ahead hasn't started: the truck is on the full load before it.
  if (!truck.trip || !truck.position || now - Date.parse(truck.position.at) > 30 * 60_000 || tripAhead(truck, ctx.loads)) return null;
  const left = tripStops(truck, ctx.loads).filter((s) => !s.done);
  if (!left.length) return null;
  const onboard = tripLoads(truck, ctx.loads).filter((l) => stopDone(l, "pickup"));
  const run = runTrip(left.map((s) => s.stop), new Map(left.map((s) => [s.load.id, s.load as TripLoad])), startOf(ctx, truck, onboard, now), trailerOf(truck), { etasOnly: true });
  return new Map(left.map((s, i) => [`${s.stop.loadId}:${s.stop.kind}`, run.etas[i]]));
}
