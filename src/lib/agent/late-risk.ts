import "server-only";
import { distanceMiles, roadMiles, roughCoords, type LatLng } from "../trip-geo";
import type { Driver, Load, Truck } from "../types";
import { alertsAlong, pointsAlong, type WeatherAlert } from "../weather";
import { route } from "./routing";

/**
 * Seeing a late truck coming the way a good dispatcher does, hours before the appointment rather than at it: the road
 * time with traffic right now, weather warnings on the road still ahead (snow and ice slow a truck by a third), the
 * driver's hours (a 10-hour break if they run out on the way), and a truck that has sat still where it shouldn't.
 */

const HOUR = 3600_000;
const MPH = 50;
const RESET_HOURS = 10;

/** How much a warning on the road ahead slows a truck: ice and blizzards most, wind and fog less. */
export function weatherFactor(alerts: Pick<WeatherAlert, "event">[]): number {
  let f = 1;
  for (const a of alerts) {
    if (/blizzard|ice storm|freezing rain|winter storm warning/i.test(a.event)) f = Math.max(f, 1.35);
    else if (/winter|snow|ice|freez|sleet/i.test(a.event)) f = Math.max(f, 1.2);
    else if (/wind|fog|dust|flood|tropical|hurricane/i.test(a.event)) f = Math.max(f, 1.1);
  }
  return f;
}

export interface Eta {
  at: number;
  /** Why it's later than a plain drive would be, in a few words each ("traffic adds 40 min", "winter storm warning"). */
  reasons: string[];
}

const minutes = (h: number) => (h >= 1 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h * 60)} min`);

/**
 * When the truck gets to a stop, with what slows it: the live road time (or the straight-line estimate), weather on the
 * way, and a 10-hour break when the driver's clock runs out first. Null with no fresh truck position.
 */
export async function etaWithReasons(truck: Truck, driver: Driver | undefined, city: string, state: string, now: number, opts: { weather?: boolean } = {}): Promise<Eta | null> {
  const pos = truck.position;
  if (!pos || now - Date.parse(pos.at) > 30 * 60_000) return null;
  const target = roughCoords(city, state);
  const here: LatLng = [pos.lat, pos.lon];
  const reasons: string[] = [];
  const r = await route({ lat: pos.lat, lon: pos.lon }, { city, state }, { live: true }).catch(() => null);
  let hours: number;
  if (r) {
    hours = r.hours;
    const traffic = r.freeHours !== undefined ? r.hours - r.freeHours : 0;
    if (traffic >= 0.25) reasons.push(`traffic adds ${minutes(traffic)}`);
  } else if (target?.exact) hours = roadMiles(here, target.at) / MPH;
  else return null;
  if (opts.weather !== false && target && distanceMiles(here, target.at) > 15) {
    const alerts = await alertsAlong(pointsAlong([here, target.at], 4), 4).catch(() => [] as WeatherAlert[]);
    const f = weatherFactor(alerts);
    if (f > 1) {
      reasons.push(`${alerts.map((a) => a.event.toLowerCase()).slice(0, 2).join(" and ")} on the way`);
      hours *= f;
    }
  }
  const clocksFresh = driver?.hos && now - Date.parse(driver.hos.at) < 2 * HOUR;
  const left = clocksFresh ? Math.min(driver!.hos!.drive, driver!.hos!.shift) : Infinity;
  if (hours > left) {
    reasons.push(`the driver's hours run out on the way (10-hour break)`);
    hours += RESET_HOURS;
  }
  return { at: now + hours * HOUR, reasons };
}

/** The ELD's new spot against the last one: whether the truck has moved, and since when it's been sitting. */
export function stillSince(prev: Truck["position"] | undefined, next: { lat: number; lon: number; at: string }, before: string | undefined): string | undefined {
  if (!prev) return undefined;
  const moved = distanceMiles([prev.lat, prev.lon], [next.lat, next.lon]) > 0.5;
  return moved ? undefined : (before ?? prev.at);
}

/**
 * A rolling truck that's been sitting 90 minutes or more somewhere that isn't one of its stops, with the driver on
 * duty (a break or the sleeper is planned and already counted in the ETA): something's up, and a dispatcher would
 * check on the driver now, not when the appointment is missed.
 */
export function stoppedOddly(load: Load, truck: Truck, driver: Driver | undefined, now: number): { minutes: number } | null {
  if (!truck.stoppedSince || !truck.position) return null;
  if (load.stage !== "dispatched" && load.stage !== "in_transit") return null;
  if (driver?.hosStatus === "sleeper" || driver?.hosStatus === "off_duty") return null;
  const mins = (now - Date.parse(truck.stoppedSince)) / 60_000;
  if (mins < 90) return null;
  const here: LatLng = [truck.position.lat, truck.position.lon];
  const stops = [roughCoords(load.lane.origin, load.lane.originState), roughCoords(load.lane.destination, load.lane.destState)];
  if (stops.some((s) => s?.exact && distanceMiles(here, s.at) < 8)) return null;
  return { minutes: Math.round(mins) };
}
