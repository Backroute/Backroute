import type { Driver } from "./types";
import { distanceMiles, type LatLng } from "./trip-geo";

/**
 * The driver's hours, counting down live: the ELD's last reading (drive, shift and cycle time left) less the time
 * since, for whichever clocks run in the current duty status. Without an ELD, the hours left the app knows.
 */

const HOUR = 3600_000;

interface HosNow {
  /** Hours left. */
  drive: number;
  shift: number;
  cycle: number | null;
  driving: boolean;
  fromEld: boolean;
}

export function hosNow(driver: Pick<Driver, "hos" | "hosStatus" | "hoursRemaining">, now: number): HosNow {
  const driving = driver.hosStatus === "driving";
  const onDuty = driving || driver.hosStatus === "on_duty";
  if (driver.hos) {
    const since = Math.max(0, (now - Date.parse(driver.hos.at)) / HOUR);
    return {
      drive: Math.max(0, driver.hos.drive - (driving ? since : 0)),
      shift: Math.max(0, driver.hos.shift - (onDuty ? since : 0)),
      cycle: Math.max(0, driver.hos.cycle - (onDuty ? since : 0)),
      driving,
      fromEld: true,
    };
  }
  return { drive: driver.hoursRemaining, shift: driver.hoursRemaining, cycle: null, driving, fromEld: false };
}

/** "3:42" */
export const clockWords = (hours: number) => {
  const m = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/** Minutes left on whichever runs out first, drive or shift. */
export const minutesLeft = (h: HosNow) => Math.round(Math.min(h.drive, h.shift) * 60);

/** The heads-ups, minutes before the clock runs out. */
export const WARN_AT = [60, 30, 15] as const;

/** Which heads-up is due now (the smallest threshold already crossed), or null. */
export function warningDue(h: HosNow): (typeof WARN_AT)[number] | null {
  const m = minutesLeft(h);
  let due: (typeof WARN_AT)[number] | null = null;
  for (const w of WARN_AT) if (m <= w) due = w;
  return due;
}

export function warningWords(minutes: number, h: HosNow): string {
  const which = h.drive <= h.shift ? "drive time" : "your shift";
  if (minutes <= 15) return `Fifteen minutes left on ${which}. Find a spot to park now.`;
  if (minutes <= 30) return `Thirty minutes left on ${which}. Start looking for parking.`;
  return `One hour left on ${which}.`;
}

// ─── Where the hours run out ─────────────────────────────────────────────────

const MPH = 50;

/** The point along a straight-line leg where the truck gets to with the hours it has, and how far that is. */
export function whereHoursEnd(from: LatLng, to: LatLng, progress: number, hoursLeft: number): { at: LatLng; miles: number; reachesStop: boolean } {
  const total = distanceMiles(from, to) * 1.2;
  const left = total * (1 - progress);
  const can = hoursLeft * MPH;
  const reachesStop = can >= left;
  const f = reachesStop ? 1 : progress + (can / total);
  return { at: [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f], miles: Math.round(Math.min(can, left)), reachesStop };
}

/** Points along the leg every ~100 miles, for weather along the way (at most `max`). */
export function samplePoints(from: LatLng, to: LatLng, progress: number, max = 6): LatLng[] {
  const miles = distanceMiles(from, to) * (1 - progress);
  const n = Math.min(max, Math.max(2, Math.ceil(miles / 100) + 1));
  return Array.from({ length: n }, (_, i) => {
    const f = progress + ((1 - progress) * i) / (n - 1);
    return [Math.round((from[0] + (to[0] - from[0]) * f) * 1000) / 1000, Math.round((from[1] + (to[1] - from[1]) * f) * 1000) / 1000] as LatLng;
  });
}
