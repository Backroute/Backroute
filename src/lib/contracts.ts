import type { Broker, ContractLane } from "./types";

/**
 * Direct shippers' scheduled freight: a contract lane runs the same route at the same rate on set weekdays. The AI
 * makes each pickup a load ahead of time (a week out), so it's planned onto a truck like any other, and invoices the
 * shipper on its own terms when it delivers.
 */

const DAY = 86400_000;

/** The pickup dates for a lane from `from` through `through` (yyyy-mm-dd), skipping ones already made. */
export function upcomingPickups(lane: ContractLane, from: string, through: string): string[] {
  if (!lane.active || !lane.days.length) return [];
  const out: string[] = [];
  const start = Math.max(Date.parse(`${from}T12:00:00Z`), lane.madeThrough ? Date.parse(`${lane.madeThrough}T12:00:00Z`) + DAY : 0);
  for (let t = start; t <= Date.parse(`${through}T12:00:00Z`); t += DAY) {
    const d = new Date(t);
    if (lane.days.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface ContractLoadPlan {
  shipper: Broker;
  lane: ContractLane;
  date: string;
  /** Pickup at the lane's time on that date (UTC, close enough for planning; the dock's own time shows on the load). */
  pickupAt: string;
}

/** Every contract pickup in the next `days` days that doesn't have a load yet. */
export function contractLoadsDue(shippers: Broker[], today: string, days = 7): ContractLoadPlan[] {
  const through = new Date(Date.parse(`${today}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  const out: ContractLoadPlan[] = [];
  for (const shipper of shippers) {
    if (!shipper.direct) continue;
    for (const lane of shipper.lanes ?? [])
      for (const date of upcomingPickups(lane, today, through)) out.push({ shipper, lane, date, pickupAt: `${date}T${lane.pickupTime || "08:00"}:00.000Z` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon, Wed, Fri at 7:00". */
export function scheduleWords(lane: ContractLane): string {
  const days = [...lane.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]);
  return `${days.join(", ") || "No days set"} at ${lane.pickupTime || "08:00"}`;
}

/** When an invoice to a direct shipper is due: the invoice date plus their terms. */
export const dueBy = (sentAt: string, terms = 30) => new Date(Date.parse(sentAt) + terms * DAY).toISOString().slice(0, 10);
