import { LANES } from "./mock-data";
import { placeCoords, roadMiles } from "./trip-geo";
import type { Driver, RunType } from "./types";

/** Federal hours of service: 11 hours driving inside a 14-hour on-duty window. */
export const HOS = { driveMax: 11, windowMax: 14 } as const;
const AVG_MPH = 50;
const DOCK_HOURS = 2;
/** A realistic day of driving once traffic, fuel and breaks are in — less than the 11 hours the law allows. */
const DRIVING_HOURS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const TARGET_DAY: Record<string, number> = { "Home by Friday": 5, "Home by Saturday": 6, "Home by Sunday": 0 };

/** Hours of driving from a city back to the driver's home base, or null when either place isn't known. */
export function hoursToHome(city: string, state: string, homeBase: string): number | null {
  const [homeCity, homeState] = homeBase.split(", ");
  const from = placeCoords(city, state);
  const home = placeCoords(homeCity, homeState);
  if (!from || !home) return null;
  return roadMiles(from, home) / AVG_MPH;
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
    return o && roadMiles(at, o) <= 150;
  }).length;
  return nearby >= 3 ? "strong" : nearby >= 1 ? "fair" : "weak";
}

export type HomeTimeState = "home" | "on_track" | "head_home" | "late" | "no_target";

export interface HomeTimeStatus {
  state: HomeTimeState;
  runType: RunType;
  homeCity: string;
  /** Hours of driving home from where the truck will be empty next. */
  hoursHome: number | null;
  /** Local: driving hours left in today's shift. */
  hoursLeftToday?: number;
  /** "Home every night", "Home by Friday", "Home by Oct 3". */
  target?: string;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The question a dispatcher asks before every load: from where this truck empties out, can the driver still make it
 * home when they need to be? Local: tonight, inside today's hours. Regional: by their weekend day. Long haul: by the
 * day this run is due to end. Plenty of room → book the best load. Getting tight → only loads heading home.
 */
export function homeTimeStatus(driver: Driver, fromCity: string, fromState: string, now: Date): HomeTimeStatus {
  const homeCity = driver.homeBase.split(", ")[0];
  const hoursHome = hoursToHome(fromCity, fromState, driver.homeBase);
  const base = { runType: driver.runType, homeCity, hoursHome };

  if (driver.runType === "local") {
    const left = driver.hoursRemaining;
    const target = "Home every night";
    if (hoursHome === null) return { ...base, state: "no_target", hoursLeftToday: left, target };
    const slack = left - hoursHome;
    // Less room than a short run plus the drive back means this is the last load of the day.
    const state: HomeTimeState = slack < 0 ? "late" : slack < 3 ? "head_home" : hoursHome < 0.5 ? "home" : "on_track";
    return { ...base, state, hoursLeftToday: left, target };
  }

  if (hoursHome !== null && hoursHome < 1) return { ...base, state: "home" };
  let drivingLeft: number;
  let target: string;
  if (driver.runType === "otr" && driver.homeDueAt) {
    const due = new Date(driver.homeDueAt);
    drivingLeft = Math.max(0, (due.getTime() - now.getTime()) / DAY_MS) * DRIVING_HOURS_PER_DAY;
    target = `Home by ${MONTH[due.getMonth()]} ${due.getDate()}`;
  } else {
    const targetDay = TARGET_DAY[driver.homeTimeTarget];
    if (targetDay === undefined) return { ...base, state: "no_target" };
    const daysLeft = (targetDay - now.getDay() + 7) % 7;
    drivingLeft = daysLeft * DRIVING_HOURS_PER_DAY + Math.max(0, Math.min(DRIVING_HOURS_PER_DAY, 20 - now.getHours()));
    target = driver.homeTimeTarget;
  }
  if (hoursHome === null) return { ...base, state: "no_target", target };
  const slack = drivingLeft - hoursHome;
  // Less than about a day's worth of room means the next load has to point home.
  const state: HomeTimeState = slack < 0 ? "late" : slack < DRIVING_HOURS_PER_DAY ? "head_home" : "on_track";
  return { ...base, state, target };
}

export function formatHours(hours: number): string {
  if (hours < 1) return "under an hour";
  const h = Math.round(hours);
  return `${h} hour${h === 1 ? "" : "s"}`;
}
