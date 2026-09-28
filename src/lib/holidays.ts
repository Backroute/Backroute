/**
 * US holidays as shipping sees them: the six days almost every shipper and receiver is closed (and the day it's
 * observed, when it falls on a weekend), and the days many run short hours or close.
 */

export interface Holiday {
  name: string;
  /** Most docks are closed. Otherwise many are, or close early. */
  closed: boolean;
}

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The nth weekday (0 = Sunday) of a month; n = -1 for the last. */
function nth(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

/** Saturday → Friday before, Sunday → Monday after. */
function observed(y: number, m: number, d: number): string | null {
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (day === 6) return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  if (day === 0) return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return null;
}

const cache = new Map<number, Map<string, Holiday>>();

export function holidaysIn(y: number): Map<string, Holiday> {
  const hit = cache.get(y);
  if (hit) return hit;
  const out = new Map<string, Holiday>();
  const add = (date: string, name: string, closed: boolean) => {
    if (!out.has(date) || closed) out.set(date, { name, closed });
  };
  const fixed = (m: number, d: number, name: string, closed: boolean) => {
    add(ymd(y, m, d), name, closed);
    const o = observed(y, m, d);
    if (o && o.startsWith(String(y))) add(o, `${name} (observed)`, closed);
  };
  fixed(1, 1, "New Year's Day", true);
  add(ymd(y, 5, nth(y, 5, 1, -1)), "Memorial Day", true);
  fixed(7, 4, "Independence Day", true);
  add(ymd(y, 9, nth(y, 9, 1, 1)), "Labor Day", true);
  const thanksgiving = nth(y, 11, 4, 4);
  add(ymd(y, 11, thanksgiving), "Thanksgiving", true);
  fixed(12, 25, "Christmas", true);
  // Short days and closures at many docks.
  add(ymd(y, 1, nth(y, 1, 1, 3)), "Martin Luther King Jr. Day", false);
  add(ymd(y, 2, nth(y, 2, 1, 3)), "Presidents' Day", false);
  fixed(6, 19, "Juneteenth", false);
  add(ymd(y, 10, nth(y, 10, 1, 2)), "Columbus Day", false);
  fixed(11, 11, "Veterans Day", false);
  add(ymd(y, 11, thanksgiving + 1), "the day after Thanksgiving", false);
  add(ymd(y, 12, 24), "Christmas Eve", false);
  add(ymd(y, 12, 31), "New Year's Eve", false);
  // New Year's Day on a Saturday is observed on Dec 31 of the year before.
  if (new Date(Date.UTC(y + 1, 0, 1)).getUTCDay() === 6) add(ymd(y, 12, 31), "New Year's Day (observed)", true);
  cache.set(y, out);
  return out;
}

/** The holiday on a date ("2026-11-26"), if any. */
export function holidayOn(date: string): Holiday | null {
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? (holidaysIn(y).get(date.slice(0, 10)) ?? null) : null;
}
