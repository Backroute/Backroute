import "server-only";
import { hourAtStop } from "../stop-time";
import type { Driver, Truck } from "../types";

/**
 * Whether a text that can wait should wait: the driver is in the sleeper by their ELD (read in the last two hours;
 * off duty is often home, a fine time to ask how it's going), or it's night where they are (QUIET_HOURS, "21-7" by
 * default), or earlier than they said to reach them.
 * For what the AI starts on its own and could say later (a move to a busier market, the weekly check-in), never for
 * what a load needs now. Returns why, or null.
 */

function quietHours(): [number, number] {
  const [a, b] = (process.env.QUIET_HOURS ?? "21-7").split("-").map(Number);
  return [Number.isFinite(a) ? a : 21, Number.isFinite(b) ? b : 7];
}

/** Where the driver is now: the truck's last known state, else their home. */
export function driverState(driver: Driver, truck?: Pick<Truck, "currentState"> | null): string {
  return truck?.currentState || driver.homeBase?.split(",")[1]?.trim() || "TX";
}

export function restingNow(driver: Driver, truck: Pick<Truck, "currentState"> | null | undefined, now = Date.now()): string | null {
  const fresh = driver.hos?.at && now - Date.parse(driver.hos.at) < 2 * 3600_000;
  if (fresh && driver.hosStatus === "sleeper") return "in the sleeper";
  const hour = hourAtStop(driverState(driver, truck), now);
  const [from, to] = quietHours();
  const night = from > to ? hour >= from || hour < to : hour >= from && hour < to;
  if (night) return "night where they are";
  if (driver.prefs?.noCallsBefore !== undefined && hour < driver.prefs.noCallsBefore) return "before the hour they said";
  return null;
}
