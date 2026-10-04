import "server-only";
import { holidayOn } from "../holidays";
import { zoneFor } from "../stop-time";
import type { Driver, Load, ScheduleWarning, Truck } from "../types";
import { postedHours } from "./dock-hours";
import { facilitiesOf, formatHours, hoursAt, type FacilityHours } from "./facility-notes";

/**
 * Whether a load's times can actually be run, checked the way a dispatcher does before saying yes: a stop on a
 * holiday most docks close for, a dock that's closed at that hour or on that day (from what drivers reported, else
 * its posted hours), and a
 * delivery window too short for one driver's legal hours. A hard problem keeps the AI from booking it on its own; a
 * soft one is mentioned to the owner and the driver.
 */

/**
 * Average truck speed on a run, and the hours-of-service rules: 11 hours driving inside a 14-hour on-duty window, a
 * 30-minute break after 8 hours of driving, 10 hours off before the next day. Each day also costs about an hour on
 * duty that isn't driving (the pre-trip inspection, fuel, a scale), which comes out of the 14.
 */
const MPH = 50;
const DWELL_HOURS = 2;
const DAILY_HOURS = 1;

/**
 * Hours from pickup to delivery a solo driver (or a team) needs to drive a run legally. `hoursLeft` is what the
 * driver has on their clock at pickup, when they can't rest before it (from the ELD); without it, a fresh day.
 */
export function hoursNeeded(miles: number, team = false, hoursLeft?: number): number {
  const drive = miles / MPH;
  // Two drivers swap in the sleeper and keep rolling: breaks, fuel and the stop at the dock.
  if (team) return drive + Math.floor(drive / 8) * 0.5 + Math.ceil(drive / 10) * 0.5 + DWELL_HOURS;
  let left = drive;
  let elapsed = DWELL_HOURS;
  let first = true;
  while (left > 0) {
    const onDutyAlready = first ? DWELL_HOURS + DAILY_HOURS : DAILY_HOURS;
    const window = 14 - onDutyAlready;
    const clock = first && hoursLeft !== undefined ? Math.max(0, Math.min(11, hoursLeft)) : 11;
    // The 30-minute break comes out of the window once they drive past 8.
    const can = Math.max(0, Math.min(clock, left, window > 8.5 ? window - 0.5 : window));
    elapsed += can + (can > 8 ? 0.5 : 0) + (first ? 0 : DAILY_HOURS);
    left -= can;
    if (left > 0) elapsed += 10;
    first = false;
  }
  return elapsed;
}

function local(iso: string, state: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(state), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: parts.weekday as string };
}

function closedAt(h: FacilityHours, when: { time: string; weekday: string }): string | null {
  if (h.days?.length && !h.days.includes(when.weekday)) return `closed on ${when.weekday}s (open ${h.days.join("/")})`;
  // That day's own hours when it keeps different ones.
  const day = h.byDay?.[when.weekday];
  const opens = day?.opens ?? h.opens;
  const closes = day?.closes ?? h.closes;
  const on = day ? ` on ${when.weekday}s` : "";
  if (opens && when.time < opens) return `opens at ${opens}${on}`;
  if (closes && when.time >= closes) return `closes at ${closes}${on}`;
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date out of a window the broker wrote in words ("Thu 11/26 8-12", "Nov 26", "2026-11-26"), as YYYY-MM-DD, for
 * loads with no exact appointment time. The year is the next one that date falls in from now.
 */
function dateFromText(text: string | undefined, now = Date.now()): string | null {
  if (!text) return null;
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (us) [month, day, year] = [Number(us[1]), Number(us[2]), us[3] ? Number(us[3].length === 2 ? `20${us[3]}` : us[3]) : null];
  else {
    const named = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
    if (named) [month, day] = [MONTHS.indexOf(named[1].toLowerCase()) + 1, Number(named[2])];
  }
  if (!month || !day || month > 12 || day > 31) return null;
  if (!year) {
    const today = new Date(now);
    year = today.getUTCFullYear();
    // A date already more than a week gone is next year's.
    if (Date.UTC(year, month - 1, day) < now - 7 * 86400_000) year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function scheduleWarnings(load: Load, truck?: Pick<Truck, "secondDriverId"> | null, carrierId?: string, driver?: Pick<Driver, "hos" | "hoursRemaining"> | null, now = Date.now()): Promise<ScheduleWarning[]> {
  const out: ScheduleWarning[] = [];
  const stops = [
    { stop: "Pickup", iso: load.pickupAt, state: load.lane.originState, city: load.lane.origin },
    { stop: "Delivery", iso: load.deliveryAt, state: load.lane.destState, city: load.lane.destination },
  ];
  const facilities = facilitiesOf(load);
  for (const s of stops) {
    // No exact time: the holiday check still runs on a date written in the window.
    if (!s.iso) {
      const date = dateFromText(s.stop === "Pickup" ? load.pickupWindow : load.deliveryWindow);
      const h = date ? holidayOn(date, s.state) : null;
      if (h) out.push({ hard: h.closed, text: `${s.stop} in ${s.city} looks to be on ${h.name} (${date})${h.closed ? ": most docks are closed. Confirm with the broker that they're open." : ": some docks are closed or close early."}` });
      continue;
    }
    const when = local(s.iso, s.state);
    const h = holidayOn(when.date, s.state);
    if (h) out.push({ hard: h.closed, text: `${s.stop} in ${s.city} is on ${h.name}${h.closed ? ": most docks are closed. Confirm with the broker that they're open." : ": some docks are closed or close early."}` });
    const f = facilities.find((x) => x.stop === (s.stop === "Pickup" ? "pickup" : "delivery"));
    const known = f ? await hoursAt(f, carrierId).catch(() => null) : null;
    const closed = known ? closedAt(known.hours, when) : null;
    // Only the carrier's own drivers' word can stop a booking; another carrier's driver's is a heads-up.
    if (f && known && closed) out.push({ hard: known.own, text: `${f.name} ${closed}, ${known.own ? "your drivers say" : "another carrier's driver says"} (${formatHours(known.hours)}), but the ${s.stop.toLowerCase()} is set for ${when.weekday} ${when.time}.` });
    // No driver has said: the place's posted hours, as a heads-up only (they're often the office's, not the dock's).
    if (f && !known) {
      const posted = await postedHours(f, s.stop === "Pickup" ? load.rateConReading?.shipperAddress : load.rateConReading?.receiverAddress);
      const shut = posted && Object.keys(posted).length ? closedAt(posted, when) : null;
      if (posted && shut) out.push({ hard: false, text: `${f.name} ${shut} by its posted hours (${formatHours(posted)}), but the ${s.stop.toLowerCase()} is set for ${when.weekday} ${when.time}. Worth confirming the dock's hours with the broker.` });
    }
  }
  // Enough time to drive it legally between the pickup and the delivery.
  if (load.pickupAt && load.deliveryAt && load.lane.miles) {
    const window = (Date.parse(load.deliveryAt) - Date.parse(load.pickupAt)) / 3600_000;
    const team = !!truck?.secondDriverId;
    // A pickup less than a 10-hour rest away starts on the hours the driver has left now (by the ELD).
    const fresh = driver?.hos?.at && now - Date.parse(driver.hos.at) < 2 * 3600_000;
    const soon = Date.parse(load.pickupAt) - now < 10 * 3600_000;
    const left = !team && fresh && soon ? driver?.hoursRemaining : undefined;
    const need = hoursNeeded(load.lane.miles, team, left);
    if (window > 0 && window + 1 < need) {
      const short = left !== undefined && hoursNeeded(load.lane.miles, team) + 1 <= window;
      out.push({ hard: true, text: `${Math.round(load.lane.miles)} miles needs about ${Math.round(need)} hours with ${team ? "a team" : "one driver's"} required breaks${short ? ` (the driver has ${Math.round((left ?? 0) * 10) / 10} hours left on their clock today)` : ""}, but pickup to delivery is only ${Math.round(window)} hours.` });
    }
  }
  return out;
}

export const hardProblem = (load: Load) => (load.scheduleWarnings ?? []).some((w) => w.hard);
