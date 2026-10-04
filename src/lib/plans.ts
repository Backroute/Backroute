import { citiesAlong, cityCoords, distanceMiles, nearestCity, roadMiles, type LatLng } from "./trip-geo";
import type { Load, TripStop } from "./types";

/**
 * Plans: the way a dispatcher thinks past one load. Loads back to back (deliver, reload close by, end up somewhere
 * good), partials sharing the trailer (pick up two or three near each other, drop them along the way), and the long
 * runs that take days. The AI puts these together from every board at once and offers each as one choice, priced and
 * timed as a whole: what it all pays, what it all costs, how many days, where the driver sleeps.
 */

/** Driving a day under the hours rules: 11 hours behind the wheel, then 10 off. At 50 mph, about 550 miles. */
const DRIVE_HOURS_A_DAY = 11;
const MPH = 50;

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
  driveHours: number;
  /** Days on the road, counting the 10 hours off after each 11 of driving. */
  days: number;
  /** Where the truck stops for the night, after which stop (index into the stops). */
  rests: { afterStop: number; place: string }[];
  /** Ends here. */
  end: { city: string; state: string };
}

export function planTotals(legs: Load[]): PlanTotals {
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
  const driveHours = totalMiles / MPH;
  const last = stops[stops.length - 1];
  return {
    pays: sum((l) => l.targetRate),
    costs,
    net: sum((l) => l.netProfit ?? 0),
    loadedMiles,
    emptyMiles,
    totalMiles,
    driveHours,
    days: Math.max(1, Math.ceil(driveHours / DRIVE_HOURS_A_DAY)),
    rests: restStops(stops, segments, first?.deadheadMiles ?? 0),
    end: last ? { city: last.city, state: last.state } : { city: "", state: "" },
  };
}

/**
 * Where the driver's 11 hours run out, day by day, along the plan's road: the nearest town to that point. The empty
 * run to the first pickup counts toward the first day.
 */
export function restStops(stops: PlanStop[], segments: Segment[], startEmpty = 0): { afterStop: number; place: string }[] {
  const perDay = DRIVE_HOURS_A_DAY * MPH;
  const out: { afterStop: number; place: string }[] = [];
  let driven = startEmpty;
  let nextRest = perDay;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const a = at(stops[i]);
    const b = at(stops[i + 1]);
    while (seg.miles > 0 && driven + seg.miles > nextRest) {
      const frac = (nextRest - driven) / seg.miles;
      const point: LatLng | undefined = a && b ? [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac] : undefined;
      // Out West towns are far apart: anything within a couple of hours' drive names the stretch.
      const town = point ? nearestCity(point, 160) : undefined;
      out.push({ afterStop: i, place: town ? `${town.city}, ${town.state}` : "on the way" });
      nextRest += perDay;
    }
    driven += seg.miles;
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
