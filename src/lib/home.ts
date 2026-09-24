import { LANES } from "./mock-data";
import { cityCoords, distanceMiles, type LatLng } from "./trip-geo";
import type { Driver } from "./types";

/** Federal hours of service: 11 hours driving inside a 14-hour on-duty window. */
export const HOS = { driveMax: 11, windowMax: 14 } as const;
const AVG_MPH = 50;
const DOCK_HOURS = 2;
/** A realistic day of driving once traffic, fuel and breaks are in — less than the 11 hours the law allows. */
const DRIVING_HOURS_PER_DAY = 10;
const ROAD_FACTOR = 1.18;

const TARGET_DAY: Record<string, number> = { "Home by Friday": 5, "Home by Saturday": 6, "Home by Sunday": 0 };

/** Coordinates for a city; home bases around Dallas–Fort Worth count as the metro. */
export function placeCoords(city: string, state: string): LatLng | undefined {
  return cityCoords(city, state) ?? (state === "TX" ? cityCoords("Dallas", "TX") : undefined);
}

/** Hours of driving from a city back to the driver's home base, or null when either place isn't known. */
export function hoursToHome(city: string, state: string, homeBase: string): number | null {
  const [homeCity, homeState] = homeBase.split(", ");
  const from = placeCoords(city, state);
  const home = placeCoords(homeCity, homeState);
  if (!from || !home) return null;
  return (distanceMiles(from, home) * ROAD_FACTOR) / AVG_MPH;
}

/** Hours of work a load takes: the empty drive to it, loading, the loaded miles and unloading. */
export function legHours(miles: number, deadheadMiles: number): number {
  return (miles + deadheadMiles) / AVG_MPH + DOCK_HOURS * 2;
}

/** Whether the whole day fits one shift and ends at home: drive to pickup, load, deliver, unload, drive home. */
export function homeTonight(miles: number, deadheadMiles: number, hoursHomeAfter: number): boolean {
  const driving = (miles + deadheadMiles) / AVG_MPH + hoursHomeAfter;
  return driving <= HOS.driveMax && driving + DOCK_HOURS * 2 <= HOS.windowMax;
}

/** How easy it is to reload out of a city — a dispatcher avoids sending a truck where nothing ships back out. */
export function reloadMarket(city: string, state: string): "strong" | "fair" | "weak" {
  const at = placeCoords(city, state);
  if (!at) return "fair";
  const nearby = LANES.filter((l) => {
    const o = placeCoords(l.origin, l.originState);
    return o && distanceMiles(at, o) * ROAD_FACTOR <= 150;
  }).length;
  return nearby >= 3 ? "strong" : nearby >= 1 ? "fair" : "weak";
}

export type HomeTimeState = "home" | "on_track" | "head_home" | "late" | "no_target";

export interface HomeTimeStatus {
  state: HomeTimeState;
  homeCity: string;
  /** Hours of driving home from where the truck will be empty next. */
  hoursHome: number | null;
  target?: string;
}

/**
 * The question a dispatcher asks before every load: from where this truck empties out, can the driver still make it
 * home when they asked to be? Plenty of slack → book the best load. Getting tight → only loads heading home.
 */
export function homeTimeStatus(driver: Driver, fromCity: string, fromState: string, now: Date): HomeTimeStatus {
  const homeCity = driver.homeBase.split(", ")[0];
  const hoursHome = hoursToHome(fromCity, fromState, driver.homeBase);
  const targetDay = TARGET_DAY[driver.homeTimeTarget];
  if (hoursHome !== null && hoursHome < 1) return { state: "home", homeCity, hoursHome };
  if (targetDay === undefined || hoursHome === null) return { state: "no_target", homeCity, hoursHome };
  const daysLeft = (targetDay - now.getDay() + 7) % 7;
  const drivingLeft = daysLeft * DRIVING_HOURS_PER_DAY + Math.max(0, Math.min(DRIVING_HOURS_PER_DAY, 20 - now.getHours()));
  const slack = drivingLeft - hoursHome;
  // Less than about a day's worth of room means the next load has to point home.
  const state: HomeTimeState = slack < 0 ? "late" : slack < DRIVING_HOURS_PER_DAY ? "head_home" : "on_track";
  return { state, homeCity, hoursHome, target: driver.homeTimeTarget };
}

export function formatHours(hours: number): string {
  if (hours < 1) return "under an hour";
  const h = Math.round(hours);
  return `${h} hour${h === 1 ? "" : "s"}`;
}
