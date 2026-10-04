/**
 * Holidays as shipping sees them: the days almost every shipper and receiver is closed (and the day it's observed,
 * when it falls on a weekend), and the days many run short hours or close. US by default; a stop in a Canadian
 * province gets Canada's (and Quebec's own).
 */

interface Holiday {
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

function holidaysIn(y: number): Map<string, Holiday> {
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

/** Easter Sunday (Gregorian), as month and day. */
function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [month, ((h + l - 7 * m + 114) % 31) + 1];
}

const PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const FAMILY_DAY = new Set(["AB", "BC", "NB", "ON", "SK"]);

const caCache = new Map<string, Map<string, Holiday>>();

/** Canada's, for a province: statutory days most docks close, and the ones only some do. */
function canadianHolidaysIn(y: number, province: string): Map<string, Holiday> {
  const key = `${y}-${province}`;
  const hit = caCache.get(key);
  if (hit) return hit;
  const out = new Map<string, Holiday>();
  const add = (date: string, name: string, closed: boolean) => {
    if (!out.has(date) || closed) out.set(date, { name, closed });
  };
  const fixed = (m: number, d: number, name: string, closed: boolean, saturdayToo = false) => {
    add(ymd(y, m, d), name, closed);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    // Canada moves a Sunday holiday to Monday; a Saturday one (Christmas, Boxing Day) to the next weekday too.
    if (day === 0) add(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10), `${name} (observed)`, closed);
    if (day === 6 && saturdayToo) add(new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10), `${name} (observed)`, closed);
  };
  const quebec = province === "QC";
  fixed(1, 1, "New Year's Day", true);
  const [em, ed] = easter(y);
  add(new Date(Date.UTC(y, em - 1, ed - 2)).toISOString().slice(0, 10), "Good Friday", true);
  if (quebec) add(new Date(Date.UTC(y, em - 1, ed + 1)).toISOString().slice(0, 10), "Easter Monday", false);
  // The Monday before May 25 (May's last Monday always falls on the 25th or later).
  const victoria = nth(y, 5, 1, -1) - 7;
  add(ymd(y, 5, victoria), quebec ? "National Patriots' Day" : "Victoria Day", true);
  if (quebec) fixed(6, 24, "Saint-Jean-Baptiste Day", true);
  fixed(7, 1, "Canada Day", true);
  add(ymd(y, 9, nth(y, 9, 1, 1)), "Labour Day", true);
  add(ymd(y, 10, nth(y, 10, 1, 2)), "Thanksgiving", true);
  fixed(12, 25, "Christmas", true, true);
  // Short days and closures at many docks.
  if (FAMILY_DAY.has(province)) add(ymd(y, 2, nth(y, 2, 1, 3)), "Family Day", false);
  if (!quebec) add(ymd(y, 8, nth(y, 8, 1, 1)), "Civic Holiday", false);
  add(ymd(y, 9, 30), "National Day for Truth and Reconciliation", false);
  fixed(11, 11, "Remembrance Day", false);
  add(ymd(y, 12, 24), "Christmas Eve", false);
  fixed(12, 26, "Boxing Day", province === "ON", true);
  add(ymd(y, 12, 31), "New Year's Eve", false);
  caCache.set(key, out);
  return out;
}

/** The holiday on a date ("2026-11-26"), if any, where the stop is (a US state, or a Canadian province). */
export function holidayOn(date: string, state?: string): Holiday | null {
  const y = Number(date.slice(0, 4));
  if (!Number.isFinite(y)) return null;
  const where = state?.trim().toUpperCase();
  if (where && PROVINCES.has(where)) return canadianHolidaysIn(y, where).get(date.slice(0, 10)) ?? null;
  return holidaysIn(y).get(date.slice(0, 10)) ?? null;
}
