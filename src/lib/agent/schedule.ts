import "server-only";
import { holidayOn } from "../holidays";
import { zoneFor } from "../stop-time";
import type { Load, ScheduleWarning, Truck } from "../types";
import { facilitiesOf, formatHours, hoursAt, type FacilityHours } from "./facility-notes";

/**
 * Whether a load's times can actually be run, checked the way a dispatcher does before saying yes: a stop on a
 * holiday most docks close for, a dock that's closed at that hour or on that day (from what drivers reported), and a
 * delivery window too short for one driver's legal hours. A hard problem keeps the AI from booking it on its own; a
 * soft one is mentioned to the owner and the driver.
 */

/** Average truck speed on a run, and the hours-of-service limits (11 driving, 10 off, a 30-minute break per 8). */
const MPH = 50;
const DWELL_HOURS = 2;

/** Hours from pickup to delivery a solo driver (or a team) needs to drive a run legally. */
export function hoursNeeded(miles: number, team = false): number {
  const drive = miles / MPH;
  if (team) return drive + Math.floor(drive / 8) * 0.5 + DWELL_HOURS;
  const resets = Math.max(0, Math.ceil(drive / 11) - 1);
  return drive + resets * 10 + Math.floor(drive / 8) * 0.5 + DWELL_HOURS;
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
  if (h.opens && when.time < h.opens) return `opens at ${h.opens}`;
  if (h.closes && when.time >= h.closes) return `closes at ${h.closes}`;
  return null;
}

export async function scheduleWarnings(load: Load, truck?: Pick<Truck, "secondDriverId"> | null): Promise<ScheduleWarning[]> {
  const out: ScheduleWarning[] = [];
  const stops = [
    { stop: "Pickup", iso: load.pickupAt, state: load.lane.originState, city: load.lane.origin },
    { stop: "Delivery", iso: load.deliveryAt, state: load.lane.destState, city: load.lane.destination },
  ];
  const facilities = facilitiesOf(load);
  for (const s of stops) {
    if (!s.iso) continue;
    const when = local(s.iso, s.state);
    const h = holidayOn(when.date);
    if (h) out.push({ hard: h.closed, text: `${s.stop} in ${s.city} is on ${h.name}${h.closed ? ": most docks are closed. Confirm with the broker that they're open." : ": some docks are closed or close early."}` });
    const f = facilities.find((x) => x.stop === (s.stop === "Pickup" ? "pickup" : "delivery"));
    const hours = f ? await hoursAt(f).catch(() => null) : null;
    const closed = hours ? closedAt(hours, when) : null;
    if (f && hours && closed) out.push({ hard: true, text: `${f.name} ${closed}, drivers say (${formatHours(hours)}), but the ${s.stop.toLowerCase()} is set for ${when.weekday} ${when.time}.` });
  }
  // Enough time to drive it legally between the pickup and the delivery.
  if (load.pickupAt && load.deliveryAt && load.lane.miles) {
    const window = (Date.parse(load.deliveryAt) - Date.parse(load.pickupAt)) / 3600_000;
    const team = !!truck?.secondDriverId;
    const need = hoursNeeded(load.lane.miles, team);
    if (window > 0 && window + 1 < need) out.push({ hard: true, text: `${Math.round(load.lane.miles)} miles needs about ${Math.round(need)} hours with ${team ? "a team" : "one driver's"} required breaks, but pickup to delivery is only ${Math.round(window)} hours.` });
  }
  return out;
}

export const hardProblem = (load: Load) => (load.scheduleWarnings ?? []).some((w) => w.hard);
