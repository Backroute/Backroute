import { LANES } from "./mock-data";
import { computeEconomics } from "./scoring";
import { cityCoords, distanceMiles, type LatLng } from "./trip-geo";
import type { Driver, Lane, Load, Truck } from "./types";

/** Federal hours of service for a property-carrying driver: 11 hours driving inside a 14-hour on-duty window, then a
 *  10-hour break; a 30-minute break after 8 hours of driving; 70 hours on duty in 8 days, reset by 34 hours off. */
export const HOS = { driveMax: 11, windowMax: 14, reset: 10, breakAfter: 8, weekMax: 70 } as const;
const AVG_MPH = 50;
const DOCK_HOURS = 2;
const DAY_START_HOUR = 6;
/** Fuel, wear and the driver's time for a mile driven empty. */
const EMPTY_MILE_COST = 1.3;

export type PlanLegKind = "current" | "booked" | "planned";

export interface PlanLeg {
  kind: PlanLegKind;
  load?: Load;
  lane: Lane;
  deadheadMiles: number;
  rate: number;
  net: number;
  /** Why the AI picked this one, in a few words. */
  reason: string;
}

export type BlockKind = "deadhead" | "drive" | "load" | "unload" | "rest" | "home";

export interface PlanBlock {
  kind: BlockKind;
  label: string;
  detail?: string;
  /** Hours from the start of that day (fractional). */
  start: number;
  hours: number;
}

export interface PlanDay {
  index: number;
  label: string;
  blocks: PlanBlock[];
}

export interface WeekPlan {
  legs: PlanLeg[];
  days: PlanDay[];
  gross: number;
  net: number;
  loadedMiles: number;
  emptyMiles: number;
  onDutyHours: number;
  homeCity: string;
  /** "Thu 6:30 PM", when the truck gets home. */
  homeAt: string;
  homeDayIndex: number;
  /** Whether that beats the driver's home-time target, when they have one. */
  homeOnTime: boolean | null;
  /** Set when the AI planned fewer loads than it could have, to keep the driver legal and home on time. */
  trimmedFor?: "home" | "hours";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TARGET_DAY: Record<string, number> = { "Home by Friday": 5, "Home by Saturday": 6, "Home by Sunday": 0 };

function coordsFor(city: string, state: string): LatLng | undefined {
  // Home bases around Dallas–Fort Worth plan to the metro.
  return cityCoords(city, state) ?? (state === "TX" ? cityCoords("Dallas", "TX") : undefined);
}

function deadhead(fromCity: string, fromState: string, lane: Lane): number {
  const a = coordsFor(fromCity, fromState);
  const b = coordsFor(lane.origin, lane.originState);
  if (!a || !b) return 60;
  const miles = distanceMiles(a, b) * 1.18;
  return miles < 15 ? 12 : Math.round(miles);
}

function economics(lane: Lane, dh: number) {
  // The AI targets a few points over market, the same way it opens a negotiation.
  const rate = Math.round(lane.miles * lane.marketRpm * 1.04);
  const fuel = Math.round(((lane.miles + dh) / 6.4) * 3.89);
  return { rate, net: computeEconomics(rate, lane.miles, dh, fuel, 40).netProfit };
}

/** The AI's pick for the leg after `from`: the best net per hour of work, or — on the last leg — the load that ends
 *  closest to home, so the week finishes where the driver lives instead of 800 miles away. */
function planLeg(fromCity: string, fromState: string, home: LatLng | undefined, homeward: boolean): PlanLeg {
  const options = LANES.map((lane) => {
    const dh = deadhead(fromCity, fromState, lane);
    const { rate, net } = economics(lane, dh);
    const hours = (lane.miles + dh) / AVG_MPH + DOCK_HOURS * 2;
    const dest = coordsFor(lane.destination, lane.destState);
    const homeMiles = home && dest ? distanceMiles(dest, home) : Infinity;
    return { lane, dh, rate, net, perHour: net / hours, homeMiles };
  }).filter((o) => o.dh <= 450);
  const pool = options.length ? options : LANES.map((lane) => ({ lane, dh: 60, ...economics(lane, 60), perHour: 0, homeMiles: Infinity }));
  // Homeward: what the load nets once the empty drive home after it is paid for too.
  const homewardValue = (o: (typeof pool)[number]) => o.net - (Number.isFinite(o.homeMiles) ? o.homeMiles * 1.18 * EMPTY_MILE_COST : 5000);
  const best = homeward
    ? pool.reduce((a, b) => (homewardValue(b) > homewardValue(a) ? b : a))
    : pool.reduce((a, b) => (b.perHour > a.perHour ? b : a));
  const reason = homeward
    ? best.homeMiles < 60
      ? "Gets you home"
      : "Heads you toward home"
    : best.dh < 30
      ? `Loads right where you empty out`
      : `Best $/hour out of ${fromCity}`;
  return { kind: "planned", lane: best.lane, deadheadMiles: best.dh, rate: best.rate, net: best.net, reason };
}

function legFromLoad(load: Load, kind: PlanLegKind): PlanLeg {
  return {
    kind,
    load,
    lane: load.lane,
    deadheadMiles: load.deadheadMiles,
    rate: load.bookedRate ?? load.targetRate,
    net: load.netProfit ?? 0,
    reason: kind === "current" ? "On it now" : "Already booked",
  };
}

function clock(hourOfDay: number): string {
  const h = Math.floor(hourOfDay) % 24;
  const m = Math.round((hourOfDay - Math.floor(hourOfDay)) * 60 / 15) * 15;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m === 60 ? 0 : m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * The next few days for one truck, planned like a dispatcher would on a whiteboard: the load it's on, anything
 * already booked, then the AI's picks for the next legs — the last one bringing the driver home — laid out
 * hour by hour inside hours-of-service limits.
 */
export function planWeek(truck: Truck, driver: Driver | undefined, current: Load | undefined, next: Load | undefined, now: Date): WeekPlan {
  // Start from three more loads and drop one at a time until the plan fits the 70-hour limit and gets the driver
  // home by their target — more miles are never worth a missed weekend or an hours-of-service violation.
  let plan = layOutPlan(truck, driver, current, next, now, 3);
  for (let n = 2; n >= 1 && (plan.onDutyHours > HOS.weekMax || plan.homeOnTime === false); n--) {
    const shorter = layOutPlan(truck, driver, current, next, now, n);
    shorter.trimmedFor = plan.onDutyHours > HOS.weekMax ? "hours" : "home";
    plan = shorter;
  }
  return plan;
}

function layOutPlan(truck: Truck, driver: Driver | undefined, current: Load | undefined, next: Load | undefined, now: Date, loadsToPlan: number): WeekPlan {
  const legs: PlanLeg[] = [];
  if (current) legs.push(legFromLoad(current, "current"));
  if (next) legs.push(legFromLoad(next, "booked"));
  const homeBase = driver?.homeBase ?? truck.homeBase;
  const [homeCityName, homeState] = homeBase.split(", ");
  const home = coordsFor(homeCityName, homeState);
  const target = loadsToPlan + (current ? 1 : 0);
  while (legs.length < target) {
    const last = legs[legs.length - 1];
    const from = last ? { city: last.lane.destination, state: last.lane.destState } : { city: truck.currentCity, state: truck.currentState };
    legs.push(planLeg(from.city, from.state, home, legs.length === target - 1));
  }

  // Lay the work out inside the hours-of-service limits, on a clock that runs in hours from today's midnight.
  const days: PlanDay[] = [];
  let t = Math.max(DAY_START_HOUR, now.getHours() + now.getMinutes() / 60);
  let driven = driver ? Math.max(0, HOS.driveMax - driver.hoursRemaining) : 0;
  let windowStart = t - driven;
  let sinceBreak = 0;
  let onDuty = 0;
  const dayAt = (i: number) => {
    if (!days[i]) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      days[i] = { index: i, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAYS[d.getDay()], blocks: [] };
    }
    return days[i];
  };
  const push = (block: Omit<PlanBlock, "start">) => {
    const day = dayAt(Math.floor(t / 24));
    day.blocks.push({ ...block, start: t - day.index * 24 });
    return day;
  };
  const rest = (where: string) => {
    push({ kind: "rest", label: "10-hour break", detail: `Sleeper berth near ${where}`, hours: HOS.reset });
    t += HOS.reset;
    windowStart = t;
    driven = 0;
    sinceBreak = 0;
  };
  const takeBreak = (where: string) => {
    push({ kind: "rest", label: "30-minute break", detail: `Truck stop near ${where}`, hours: 0.5 });
    t += 0.5;
    sinceBreak = 0;
  };
  const work = (kind: BlockKind, label: string, detail: string, hours: number, where: string, driving: boolean) => {
    let left = hours;
    // Every pass either books time or takes a break; the cap only guards against a bad input looping forever.
    for (let guard = 0; left > 0.01 && guard < 200; guard++) {
      const driveRoom = driving ? HOS.driveMax - driven : Infinity;
      const windowRoom = HOS.windowMax - (t - windowStart);
      const limit = Math.min(driveRoom, windowRoom, driving ? HOS.breakAfter - sinceBreak + 0.001 : Infinity);
      if (limit <= 0.05) {
        if (driving && sinceBreak >= HOS.breakAfter && driveRoom > 0.5 && windowRoom > 1) takeBreak(where);
        else rest(where);
        continue;
      }
      const room = Math.min(left, limit);
      const day = dayAt(Math.floor(t / 24));
      const last = day.blocks[day.blocks.length - 1];
      const at = t - day.index * 24;
      if (last && last.kind === kind && last.label === label && Math.abs(last.start + last.hours - at) < 0.6) last.hours = at + room - last.start;
      else day.blocks.push({ kind, label, detail, start: at, hours: room });
      t += room;
      left -= room;
      onDuty += room;
      if (driving) {
        driven += room;
        sinceBreak += room;
        if (sinceBreak >= HOS.breakAfter && left > 0.01 && driven < HOS.driveMax) takeBreak(where);
      }
    }
  };

  for (const leg of legs) {
    const from = `${leg.lane.origin}, ${leg.lane.originState}`;
    const to = `${leg.lane.destination}, ${leg.lane.destState}`;
    const s = leg.load?.stage;
    const pastPickup = s === "in_transit" || s === "at_delivery";
    if (!pastPickup && s !== "at_pickup" && leg.deadheadMiles > 0) {
      work("deadhead", `Empty to ${leg.lane.origin}`, `${leg.deadheadMiles} mi`, leg.deadheadMiles / AVG_MPH, leg.lane.origin, true);
    }
    if (!pastPickup) work("load", `Load in ${leg.lane.origin}`, from, DOCK_HOURS, leg.lane.origin, false);
    const remaining = s === "in_transit" ? Math.round(leg.lane.miles * 0.6) : s === "at_delivery" ? 0 : leg.lane.miles;
    if (remaining > 0) work("drive", `${leg.lane.origin} → ${leg.lane.destination}`, `${remaining} mi loaded`, remaining / AVG_MPH, leg.lane.destination, true);
    work("unload", `Deliver in ${leg.lane.destination}`, to, DOCK_HOURS, leg.lane.destination, false);
  }

  const lastLeg = legs[legs.length - 1];
  const endCoords = lastLeg ? coordsFor(lastLeg.lane.destination, lastLeg.lane.destState) : undefined;
  const homeMiles = home && endCoords ? Math.round(distanceMiles(endCoords, home) * 1.18) : 0;
  if (homeMiles > 20) work("deadhead", `Head home to ${homeCityName}`, `${homeMiles} mi`, homeMiles / AVG_MPH, homeCityName, true);
  push({ kind: "home", label: `Home in ${homeCityName}`, detail: "34-hour reset, hours of service start fresh", hours: 0 });
  const dayIndex = Math.floor(t / 24);
  const homeDate = new Date(now);
  homeDate.setDate(homeDate.getDate() + dayIndex);
  const targetDay = driver ? TARGET_DAY[driver.homeTimeTarget] : undefined;
  const daysUntilTarget = targetDay === undefined ? null : (targetDay - now.getDay() + 7) % 7;

  return {
    legs,
    days: days.filter(Boolean),
    gross: legs.reduce((sum, l) => sum + l.rate, 0),
    net: legs.reduce((sum, l) => sum + l.net, 0),
    loadedMiles: legs.reduce((sum, l) => sum + l.lane.miles, 0),
    emptyMiles: legs.reduce((sum, l) => sum + l.deadheadMiles, 0) + (homeMiles > 20 ? homeMiles : 0),
    onDutyHours: Math.round(onDuty),
    homeCity: homeCityName,
    homeAt: `${dayIndex === 0 ? "today" : dayIndex === 1 ? "tomorrow" : WEEKDAYS[homeDate.getDay()]} ${clock(t - dayIndex * 24)}`,
    homeDayIndex: dayIndex,
    homeOnTime: daysUntilTarget === null ? null : dayIndex <= daysUntilTarget,
  };
}

/** Hours of work a leg takes: the empty drive to it, loading, the loaded miles and unloading. */
export function legHours(miles: number, deadheadMiles: number): number {
  return (miles + deadheadMiles) / AVG_MPH + DOCK_HOURS * 2;
}

/** The AI's best guess at the load home from wherever a load delivers — or null when it already ends near home. */
export function estimateLoadHome(fromCity: string, fromState: string, homeBase: string): PlanLeg | null {
  const [city, state] = homeBase.split(", ");
  const home = coordsFor(city, state);
  const from = coordsFor(fromCity, fromState);
  if (!home || !from || distanceMiles(from, home) < 60) return null;
  return planLeg(fromCity, fromState, home, true);
}

export function formatClock(hourOfDay: number): string {
  return clock(hourOfDay);
}
