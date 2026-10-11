import { holidayOn } from "./holidays";
import { hourAtStop, zoneFor } from "./stop-time";
import type { Load, Truck } from "./types";

/**
 * How the AI weighs one load against another for a truck, beyond the money on the load: the hours it ties the truck
 * up (waiting for the pickup, the docks, the miles), dead time after a Friday or holiday delivery, getting paid
 * sooner, sharing good loads across trucks, and what the owner's own picks showed. No I/O: lib/agent/booking uses it.
 */

const DAY = 86400_000;
const HOUR = 3600_000;
const MPH = 50;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * What a truck nets an hour on the carrier's own delivered loads (the last 90 days, five or more): the price of an
 * hour a load ties the truck up. Null without enough history, and then time isn't priced.
 */
export function netPerHour(loads: Pick<Load, "stage" | "netProfit" | "lane" | "deadheadMiles" | "updatedAt">[], now: number): number | null {
  const done = loads.filter((l) => l.stage === "delivered" && (l.netProfit ?? 0) > 0 && Date.parse(l.updatedAt) > now - 90 * DAY);
  if (done.length < 5) return null;
  const hours = done.reduce((s, l) => s + (l.lane.miles + (l.deadheadMiles ?? 0)) / MPH + 4, 0);
  const net = done.reduce((s, l) => s + (l.netProfit ?? 0), 0);
  return hours > 0 ? Math.round(net / hours) : null;
}

/**
 * Hours from now until the truck is free again after this load: waiting for the pickup (up to three days), the empty
 * drive, each dock (from history, else 2 hours), and the loaded miles. A load tomorrow costs a day of waiting.
 */
export function hoursTiedUp(o: { now: number; pickupAt?: number | null; miles: number; deadhead: number; dockHours?: { pickup?: number; delivery?: number } }): number {
  const work = (o.miles + o.deadhead) / MPH + (o.dockHours?.pickup ?? 2) + (o.dockHours?.delivery ?? 2);
  const wait = o.pickupAt ? Math.max(0, (o.pickupAt - o.now) / HOUR - o.deadhead / MPH) : 0;
  return round1(work + Math.min(wait, 72));
}

function localDay(iso: string, state: string): { weekday: number; hour: number; date: string } {
  const at = Date.parse(iso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(state), weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, hour: hourAtStop(state, at), date: `${get("year")}-${get("month")}-${get("day")}` };
}

/**
 * Dead hours after a delivery: a Friday afternoon, Saturday or Sunday delivery, or the day before a holiday, sits
 * until 6 AM on the next working day when the market there isn't strong (half of that where it's fair).
 */
export function deadHours(deliveryAt: string | undefined, state: string, outlook: "strong" | "fair" | "weak"): number {
  if (!deliveryAt || outlook === "strong") return 0;
  const { weekday, hour, date } = localDay(deliveryAt, state);
  const rest = 24 - hour + 6;
  let hours = 0;
  if (weekday === 5 && hour >= 12) hours = rest + 48;
  else if (weekday === 6) hours = rest + 24;
  else if (weekday === 0) hours = rest;
  else {
    const next = new Date(Date.parse(`${date}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
    if (holidayOn(next, state)) hours = rest;
  }
  return outlook === "weak" ? hours : Math.round(hours / 2);
}

/**
 * Getting paid sooner is worth about 1% of the rate a month (what quick pay and factoring charge for it), measured
 * against the 30 days most brokers take. Unknown pay speed counts as 30. Never more than 2% either way.
 */
export function payerEdge(rate: number, avgDaysToPay: number | undefined): number {
  if (!rate || !avgDaysToPay) return 0;
  const edge = (rate * 0.01 * (30 - avgDaysToPay)) / 30;
  return Math.round(Math.max(-rate * 0.02, Math.min(rate * 0.02, edge)));
}

/** What each truck has grossed on loads picked up in the last seven days. */
export function weekGross(loads: Pick<Load, "truckId" | "stage" | "bookedRate" | "pickupAt">[], now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of loads) {
    if (!l.truckId || !l.bookedRate || !l.pickupAt || ["offered", "negotiating", "declined", "cancelled", "sourced", "scoring"].includes(l.stage)) continue;
    const at = Date.parse(l.pickupAt);
    if (at < now - 7 * DAY || at > now + DAY) continue;
    out.set(l.truckId, (out.get(l.truckId) ?? 0) + l.bookedRate);
  }
  return out;
}

/** Good loads shared out: a truck behind the fleet's weekly average gets a nudge of 5% of the gap (at most $150), one ahead the same down. */
export function fairnessNudge(truckId: string, gross: Map<string, number>, trucks: Pick<Truck, "id" | "driverId">[]): number {
  const working = trucks.filter((t) => t.driverId);
  if (working.length < 2) return 0;
  const avg = working.reduce((s, t) => s + (gross.get(t.id) ?? 0), 0) / working.length;
  const gap = avg - (gross.get(truckId) ?? 0);
  return Math.round(Math.max(-150, Math.min(150, gap * 0.05)));
}

/**
 * What the owner's own picks taught: each time they booked an offer other than the one the AI ranked first, what was
 * different. Brokers they keep choosing get a nudge ($50 a pick, up to $150), and when they keep choosing fewer empty
 * miles (three times or more), empty miles count 50 cents more each.
 */
export function ownerLeanings(loads: Pick<Load, "ownerPick" | "brokerId">[]): { brokers: Map<string, number>; deadheadPerMile: number } {
  const brokers = new Map<string, number>();
  let shorter = 0;
  for (const l of loads) {
    const p = l.ownerPick;
    if (!p || !p.overAi) continue;
    brokers.set(l.brokerId, Math.min(150, (brokers.get(l.brokerId) ?? 0) + 50));
    if (p.lessDeadhead) shorter++;
  }
  return { brokers, deadheadPerMile: shorter >= 3 ? 0.5 : 0 };
}

/** The broker's share of extra pay (detention, layover, extras) actually paid, on loads paid in full or short. Null under three. */
export function extrasPaidPct(loads: Load[], brokerId: string): number | null {
  const claimed = loads.filter((l) => l.brokerId === brokerId && l.invoice?.paidAt && (l.invoice.lines ?? []).some((x) => !/^Line haul/.test(x.label)));
  if (claimed.length < 3) return null;
  const paid = claimed.filter((l) => (l.invoice!.paidAmount ?? l.invoice!.amount) >= l.invoice!.amount).length;
  return Math.round((paid / claimed.length) * 100);
}

/** "No detention", "detention not paid": a posting or rate con that won't pay for waiting. */
export function noDetention(text: string | null | undefined): boolean {
  return !!text && /\bno detention\b|detention (?:is )?not (?:paid|covered|offered)|detention:\s*(?:none|n\/a|no)\b/i.test(text);
}

/** "Power only" in a posting: the shipper's trailer, our tractor. */
export function powerOnly(text: string | null | undefined): boolean {
  return !!text && /\bpower[- ]?only\b|\bPO load\b/i.test(text);
}

