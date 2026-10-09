import { citiesAlong, cityCoords, distanceMiles, nearestCity, roadMiles, roughCoords, type LatLng } from "./trip-geo";
import { isPartial, planTrip, type TripLoad } from "./trip-plan";
import { DOCK_HOURS, PLAN_MPH, STOP_HOURS, simulateRun, type Crew, type RunStep } from "./hos-plan";
import type { Load, TripStop } from "./types";

/**
 * Plans: the way a dispatcher thinks past one load. Loads back to back (deliver, reload close by, end up somewhere
 * good), partials sharing the trailer (pick up two or three near each other, drop them along the way), and the long
 * runs that take days. The AI puts these together from every board at once and offers each as one choice, priced and
 * timed as a whole: what it all pays, what it all costs, how many days, where the driver sleeps.
 */

/** One choice on the board: a single load, or every load of a plan in order. Best fit first, then by fit score. */
export function offerOptions(loads: Load[]): Load[][] {
  const groups = new Map<string, Load[]>();
  for (const l of loads) {
    const key = l.plan?.id ?? l.id;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.values()]
    .map((legs) => [...legs].sort((a, b) => (a.plan?.leg ?? 1) - (b.plan?.leg ?? 1)))
    .sort((a, b) => Number(b.some((l) => l.recommended)) - Number(a.some((l) => l.recommended)) || optionScore(b) - optionScore(a));
}

/** A plan's fit: its loads' scores weighted by what each pays. */
export function optionScore(legs: Load[]): number {
  const pay = legs.reduce((s, l) => s + l.targetRate, 0) || 1;
  return Math.round(legs.reduce((s, l) => s + l.score * l.targetRate, 0) / pay);
}

export interface PlanStop {
  kind: "pickup" | "delivery";
  city: string;
  state: string;
  load: Load;
  /** Which load of the plan, 1-based. */
  leg: number;
  /** An extra pickup or drop on a multi-stop load (between its first pickup and last drop). */
  extra?: boolean;
  /** For an extra stop: the window the broker gave, if any. */
  window?: string;
}

/** Every stop of a plan in the order the truck makes them. */
export function planStops(legs: Load[]): PlanStop[] {
  const order = legs[0]?.plan?.kind === "shared_trailer" ? legs[0].plan.order : undefined;
  if (order?.length) {
    const byId = new Map(legs.map((l) => [l.id, l]));
    return order
      .filter((s) => byId.has(s.loadId))
      .map((s) => {
        const load = byId.get(s.loadId)!;
        const place = s.kind === "pickup" ? { city: load.lane.origin, state: load.lane.originState } : { city: load.lane.destination, state: load.lane.destState };
        return { kind: s.kind, ...place, load, leg: load.plan?.leg ?? 1 };
      });
  }
  return legs.flatMap((load, i) => {
    const leg = load.plan?.leg ?? i + 1;
    const extra = [...(load.stops ?? [])].sort((a, b) => a.sequence - b.sequence).map((s) => ({ kind: s.kind, city: s.city, state: s.state, load, leg, extra: true, window: s.window }));
    return [
      { kind: "pickup" as const, city: load.lane.origin, state: load.lane.originState, load, leg },
      ...extra,
      { kind: "delivery" as const, city: load.lane.destination, state: load.lane.destState, load, leg },
    ];
  });
}

const at = (s: { city: string; state: string }): LatLng | undefined => cityCoords(s.city, s.state);

/** Miles between two stops, and whether there's freight on the truck for them. */
export interface Segment {
  miles: number;
  loaded: boolean;
}

/** The drive between each stop and the next (one fewer than the stops). */
export function planSegments(legs: Load[], stops: PlanStop[] = planStops(legs)): Segment[] {
  const out: Segment[] = [];
  let onboard = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (a.kind === "pickup" && !a.extra) onboard++;
    if (a.kind === "delivery" && !a.extra) onboard--;
    const pa = at(a);
    const pb = at(b);
    let miles = pa && pb ? Math.round(roadMiles(pa, pb)) : 0;
    // A single load's own miles are the broker's; split over its extra stops when there are some.
    if (a.load === b.load && !legs[0]?.plan?.order) {
      const own = stops.filter((s) => s.load === a.load);
      if (own.length === 2) miles = a.load.lane.miles;
    }
    // Back to back: the empty run to the next pickup is what the AI priced it at.
    if (a.load !== b.load && b.kind === "pickup" && !legs[0]?.plan?.order) miles = b.load.deadheadMiles;
    out.push({ miles, loaded: onboard > 0 });
  }
  return out;
}

export interface PlanTotals {
  pays: number;
  costs: { label: string; amount: number }[];
  /** What's left after every cost. */
  net: number;
  loadedMiles: number;
  /** Empty: to the first pickup, and between loads. */
  emptyMiles: number;
  totalMiles: number;
  /** Hours behind the wheel, all of it. */
  driveHours: number;
  /** Days on the road from the first pickup to the last drop, the clocks run the way the rules say. */
  days: number;
  /** Where the driver stops for the night, after which stop (index into the stops), and for how long (10 hours, 7
   *  after a split, 34 for the week's restart). A team truck only stops for a restart. */
  rests: { afterStop: number; place: string; hours: number }[];
  /** Hours from leaving for the first pickup to getting to the last drop: the truck's time on this. */
  hours: number;
  /** Ends here. */
  end: { city: string; state: string };
}

/** The run as the driver's clocks see it: the empty drive to the first pickup, then a dock and a drive per stop. */
export function planSteps(legs: Load[], stops: PlanStop[] = planStops(legs), segments: Segment[] = planSegments(legs, stops)): RunStep[] {
  const first = legs.find((l) => (l.plan?.leg ?? 1) === 1) ?? legs[0];
  const steps: RunStep[] = [{ kind: "drive", miles: Math.max(0, first?.deadheadMiles ?? 0) }];
  stops.forEach((stop, i) => {
    const sameDock = i > 0 && segments[i - 1]?.miles === 0;
    steps.push({ kind: "dock", hours: stop.extra || sameDock ? STOP_HOURS : DOCK_HOURS });
    if (segments[i]) steps.push({ kind: "drive", miles: segments[i].miles });
  });
  return steps;
}

export function planTotals(legs: Load[], crew: Crew = {}): PlanTotals {
  const stops = planStops(legs);
  const segments = planSegments(legs, stops);
  const first = legs.find((l) => (l.plan?.leg ?? 1) === 1) ?? legs[0];
  const loadedMiles = segments.filter((s) => s.loaded).reduce((n, s) => n + s.miles, 0);
  const emptyBetween = segments.filter((s) => !s.loaded).reduce((n, s) => n + s.miles, 0);
  const emptyMiles = Math.max(0, first?.deadheadMiles ?? 0) + emptyBetween;
  const totalMiles = loadedMiles + emptyMiles;
  const sum = (f: (l: Load) => number) => legs.reduce((n, l) => n + f(l), 0);
  const emptyNote = emptyMiles > 0 ? ` (${emptyMiles.toLocaleString()} mi)` : "";
  const costs = [
    { label: "Fuel", amount: sum((l) => l.fuelCost) },
    { label: "Tolls", amount: sum((l) => l.tollCost) },
    { label: `Empty miles${emptyNote}`, amount: sum((l) => l.deadheadCost) },
    { label: "Backroute fee (2%)", amount: sum((l) => l.commission) },
  ].filter((c) => c.amount > 0);
  // The whole run played forward from the start of the empty drive: days counted from getting to the first pickup to
  // getting to the last drop, the way the card counts them from the docks' windows.
  const steps = planSteps(legs, stops, segments);
  const run = simulateRun(steps, 0, crew);
  const atFirstPickup = run.doneAt[0] ?? 0;
  const atLastDrop = run.doneAt[run.doneAt.length - 2] ?? run.end;
  const days = Math.max(1, Math.ceil((atLastDrop - atFirstPickup) / 86_400_000 - 1e-9));
  const last = stops[stops.length - 1];
  return {
    pays: sum((l) => l.targetRate),
    costs,
    net: sum((l) => l.netProfit ?? 0),
    loadedMiles,
    emptyMiles,
    totalMiles,
    driveHours: run.driveHours,
    days,
    rests: restStops(stops, segments, run.rests, Math.max(0, first?.deadheadMiles ?? 0)),
    hours: atLastDrop / 3_600_000,
    end: last ? { city: last.city, state: last.state } : { city: "", state: "" },
  };
}

/**
 * Each night's rest put on the road: which drive between stops it falls in, and the nearest town to that point. A rest
 * on the empty drive to the first pickup isn't shown (the driver sleeps before the load starts).
 */
export function restStops(stops: PlanStop[], segments: Segment[], rests: { mile: number; hours?: number }[], startEmpty = 0): { afterStop: number; place: string; hours: number }[] {
  const out: { afterStop: number; place: string; hours: number }[] = [];
  for (const r of rests) {
    let from = startEmpty;
    if (r.mile <= from) continue;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (r.mile <= from + seg.miles + 1e-6) {
        const frac = seg.miles ? (r.mile - from) / seg.miles : 0;
        const a = at(stops[i]);
        const b = at(stops[i + 1]);
        const point: LatLng | undefined = a && b ? [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac] : undefined;
        // Out West towns are far apart: anything within a couple of hours' drive names the stretch.
        const town = point ? nearestCity(point, 160) : undefined;
        out.push({ afterStop: i, place: town ? `${town.city}, ${town.state}` : "on the way", hours: r.hours ?? 10 });
        break;
      }
      from += seg.miles;
    }
  }
  return out;
}

/** "2 loads back to back", "3 loads, one trailer", "Long run", "2 stops": what kind of choice it is, in a few words. */
export function planLabel(legs: Load[], days: number): string | null {
  const kind = legs[0]?.plan?.kind;
  if (kind === "back_to_back") return `${legs.length} loads back to back`;
  if (kind === "shared_trailer") return `${legs.length} loads, one trailer`;
  const extra = legs[0]?.stops?.length ?? 0;
  if (extra) return `${extra + 2} stops`;
  if (days >= 2) return `Long run · ${days} days`;
  return null;
}

/** A town on the road from one city to another, for an extra drop or a partial that rides along. */
export function townOnTheWay(from: { city: string; state: string }, to: { city: string; state: string }, avoid: string[] = []): { city: string; state: string; milesFromStart: number } | undefined {
  const a = cityCoords(from.city, from.state);
  const b = cityCoords(to.city, to.state);
  if (!a || !b) return undefined;
  const hit = citiesAlong(a, b).find((c) => !avoid.includes(`${c.city}, ${c.state}`) && !(c.city === from.city && c.state === from.state) && !(c.city === to.city && c.state === to.state));
  return hit ? { city: hit.city, state: hit.state, milesFromStart: Math.round(roadMiles(a, hit.at)) } : undefined;
}

/** Straight miles between two cities times the usual detour, or undefined when either isn't known. */
export function milesBetween(a: { city: string; state: string }, b: { city: string; state: string }): number | undefined {
  const pa = at(a);
  const pb = at(b);
  return pa && pb ? Math.round(roadMiles(pa, pb)) : undefined;
}

/** Shared-trailer stops for two loads picked up in the same place: both on, then the nearer drop first. */
export function sharedOrder(a: Load, b: Load): TripStop[] {
  const pa = at({ city: a.lane.origin, state: a.lane.originState });
  const da = at({ city: a.lane.destination, state: a.lane.destState });
  const db = at({ city: b.lane.destination, state: b.lane.destState });
  const aFirst = !pa || !da || !db || distanceMiles(pa, da) <= distanceMiles(pa, db);
  const [near, far] = aFirst ? [a, b] : [b, a];
  return [
    { loadId: a.id, kind: "pickup" },
    { loadId: b.id, kind: "pickup" },
    { loadId: near.id, kind: "delivery" },
    { loadId: far.id, kind: "delivery" },
  ];
}

/** How far apart a drop and the next pickup can be for two loads to run back to back. */
const PAIR_EMPTY_MILES = 150;
/** Most docks give about an hour's grace on an appointment. */
const PAIR_GRACE_HOURS = 1;

/** Empty miles from one load's drop to the next one's pickup, when the truck can make it after unloading. */
function chainsTo(a: Load, b: Load): number | null {
  if (a.truckId !== b.truckId) return null;
  const empty = milesBetween({ city: a.lane.destination, state: a.lane.destState }, { city: b.lane.origin, state: b.lane.originState });
  if (empty === undefined || empty > PAIR_EMPTY_MILES) return null;
  const there = Date.parse(a.deliveryAt!) + (DOCK_HOURS + empty / PLAN_MPH) * 3_600_000;
  return there > Date.parse(b.pickupAt!) + PAIR_GRACE_HOURS * 3_600_000 ? null : empty;
}

/** The best plans first, at most two, no load in two of them. */
function bestPlans(plans: { legs: Load[]; score: number }[]): Load[][] {
  const used = new Set<string>();
  const out: Load[][] = [];
  for (const p of plans.sort((x, y) => y.score - x.score)) {
    if (out.length >= 2 || p.legs.some((l) => used.has(l.id))) continue;
    p.legs.forEach((l) => used.add(l.id));
    out.push(p.legs);
  }
  return out;
}

/**
 * Real accounts: loads brokers emailed for the same truck that chain, two or three in a row, offered as one plan next
 * to the singles, the way a dispatcher sees a reload while booking the first: each picks up within 150 miles of the
 * one before's drop, and the truck can get there after unloading (two hours at the dock, the empty miles at plan
 * speed). Built from the loads already offered, so each still books on its own; booking the plan asks every broker.
 * Best first (what the plan nets), at most two, no load in two of them. Each later load's empty miles and costs are
 * counted from the drop before it.
 */
export function emailedPairs(loads: Load[]): Load[][] {
  const singles = loads.filter((l) => !l.plan && l.stage === "offered" && !l.partial && !l.lane.moveKind && l.pickupAt && l.deliveryAt);
  const chains: Load[][] = [];
  for (const a of singles)
    for (const b of singles) {
      if (a === b || chainsTo(a, b) === null) continue;
      chains.push([a, b]);
      for (const c of singles) if (c !== a && c !== b && chainsTo(b, c) !== null) chains.push([a, b, c]);
    }
  const plans = chains.map((legs) => {
    const id = `${legs.length === 2 ? "pair" : "chain"}-${legs.map((l) => l.id).join("-")}`;
    const out = legs.map((l, k) => {
      const plan = { id, kind: "back_to_back" as const, leg: k + 1, legs: legs.length };
      if (k === 0) return { ...l, recommended: false, plan };
      const empty = chainsTo(legs[k - 1], l)!;
      const perMile = l.deadheadMiles > 0 ? l.deadheadCost / l.deadheadMiles : 0.61;
      const deadheadCost = Math.round(empty * perMile);
      return { ...l, recommended: false, deadheadMiles: empty, deadheadCost, netProfit: (l.netProfit ?? 0) + l.deadheadCost - deadheadCost, plan };
    });
    return { legs: out, score: out.reduce((sum, l) => sum + (l.netProfit ?? 0), 0) };
  });
  return bestPlans(plans);
}

/** How far apart two partials' pickups can be and still go on together (the way a dispatcher builds a run). */
const TRIP_PICKUPS_MILES = 60;

/**
 * A real account's emailed partials that can share the trailer, put together as one choice: two or three partials
 * for the same truck picking up within 60 miles of each other, with room for all of them and every appointment made
 * in the order the stops are planned (lib/trip-plan). Each load keeps its own broker and price; booking the choice
 * asks for each. At most two, the best paying first, no load in two of them.
 */
export function emailedTrips(loads: Load[]): Load[][] {
  const partials = loads.filter((l) => !l.plan && l.stage === "offered" && isPartial(l) && l.pickupAt);
  const near = (a: Load, b: Load) => {
    if (a.truckId !== b.truckId || a.equipmentType !== b.equipmentType) return false;
    const apart = milesBetween({ city: a.lane.origin, state: a.lane.originState }, { city: b.lane.origin, state: b.lane.originState });
    return apart !== undefined && apart <= TRIP_PICKUPS_MILES;
  };
  const groups: Load[][] = [];
  for (let i = 0; i < partials.length; i++)
    for (let j = i + 1; j < partials.length; j++) {
      if (!near(partials[i], partials[j])) continue;
      groups.push([partials[i], partials[j]]);
      for (let k = j + 1; k < partials.length; k++) if (near(partials[i], partials[k]) && near(partials[j], partials[k])) groups.push([partials[i], partials[j], partials[k]]);
    }
  const plans: { legs: Load[]; score: number }[] = [];
  for (const group of groups) {
    const first = group.reduce((x, y) => (Date.parse(x.pickupAt!) <= Date.parse(y.pickupAt!) ? x : y));
    const at = roughCoords(first.lane.origin, first.lane.originState)?.at ?? null;
    const planned = planTrip(group as TripLoad[], { at, time: Date.parse(first.pickupAt!) - 3_600_000, onboard: [] }, { feet: 53, lbs: 44000 });
    if (!planned) continue;
    const id = `trip-${group.map((l) => l.id).join("-")}`;
    const order = planned.order;
    // Legs in the order they're picked up.
    const pickedAt = (l: Load) => order.findIndex((st) => st.loadId === l.id && st.kind === "pickup");
    const legs = [...group].sort((x, y) => pickedAt(x) - pickedAt(y));
    plans.push({ legs: legs.map((l, k) => ({ ...l, recommended: false, plan: { id, kind: "shared_trailer" as const, leg: k + 1, legs: legs.length, order } })), score: legs.reduce((sum, l) => sum + l.targetRate, 0) });
  }
  return bestPlans(plans);
}
