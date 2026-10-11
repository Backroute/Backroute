import { placeCoords, roadMiles, type LatLng } from "./trip-geo";
import type { Driver, ExtraClaim, ExtraKind, Load, Roadside, Truck } from "./types";

/**
 * What goes wrong on the road after the load is booked, worked out the way a dispatcher does: extra pay for work
 * beyond the haul (what it's worth, and the driver's share of it), how long a shop said a repair will take, when a
 * broken-down load needs another truck, and a truck heading the wrong way. No I/O: lib/agent/extras and
 * lib/agent/recovery act on it.
 */

export const EXTRA_LABEL: Record<ExtraKind, string> = {
  driver_assist: "Driver assist (loading or unloading by the driver)",
  tarp: "Tarping",
  scale: "Scale ticket",
  redelivery: "Redelivery",
  out_of_route: "Out-of-route miles",
  reefer_fuel: "Reefer fuel",
};

/** The driver's own work: they share in what it earns. The rest pays back a cost. */
export const DRIVER_WORK: ExtraKind[] = ["driver_assist", "tarp", "redelivery", "out_of_route"];

/** Costs paid back from a receipt: the amount is what the receipt says. */
const RECEIPT: ExtraKind[] = ["scale", "reefer_fuel"];

const WORDS: Partial<Record<ExtraKind, string>> = {
  tarp: "tarp\\w*",
  driver_assist: "(?:driver[- ]assist\\w*|driver (?:load|unload)\\w*|hand[- ]?(?:load|unload)\\w*)",
  redelivery: "re-?deliver\\w*",
};

/** "Tarp pay $100", "$75 driver assist", "out of route $2.50/mi": the broker's own price for it, or null. */
export function rateConTerm(kind: ExtraKind, text: string | null | undefined): number | null {
  if (!text) return null;
  if (kind === "out_of_route") {
    const m = text.match(/out[- ]of[- ]route[^$\n]{0,40}\$\s?(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/|per)\s*(?:mi|mile)/i);
    return m ? Number(m[1]) : null;
  }
  const w = WORDS[kind];
  if (!w) return null;
  const m = text.match(new RegExp(`${w}[^$\\n]{0,40}\\$\\s?(\\d{2,4})(?:\\.\\d{2})?`, "i")) ?? text.match(new RegExp(`\\$\\s?(\\d{2,4})(?:\\.\\d{2})?[^.$\\n]{0,25}${w}`, "i"));
  return m ? Number(m[1]) : null;
}

/** Everything the broker wrote about the load: the rate con as read, and the posting's notes. */
export function brokerTerms(load: Pick<Load, "rateConReading" | "offerNotes">): string {
  const r = load.rateConReading;
  return [r?.detention ?? "", ...(r?.finesAndFees ?? []), ...(r?.otherConcerns ?? []), r?.summary ?? "", load.offerNotes ?? ""].join("\n");
}

/**
 * What to claim, and from what: a receipt's total; the broker's own price on the rate con; the owner's price list; or,
 * for miles out of route, the miles at the load's own rate a mile. Null: nothing to go on yet (ask for the receipt,
 * or the owner's price).
 */
export function extraAmount(
  claim: Pick<ExtraClaim, "kind" | "amount" | "miles">,
  load: Pick<Load, "rateConReading" | "offerNotes" | "bookedRate" | "lane">,
  ownerPrices?: Partial<Record<ExtraKind, number>>,
): { amount: number; basis: NonNullable<ExtraClaim["basis"]> } | null {
  if (RECEIPT.includes(claim.kind)) return claim.amount && claim.amount > 0 ? { amount: Math.round(claim.amount * 100) / 100, basis: "receipt" } : null;
  const term = rateConTerm(claim.kind, brokerTerms(load));
  if (claim.kind === "out_of_route") {
    if (!claim.miles || claim.miles < 1) return null;
    if (term) return { amount: Math.round(claim.miles * term), basis: "rate_con" };
    const perMile = load.bookedRate && load.lane.miles ? load.bookedRate / load.lane.miles : null;
    return perMile ? { amount: Math.round(claim.miles * perMile), basis: "per_mile" } : null;
  }
  if (term) return { amount: term, basis: "rate_con" };
  const own = ownerPrices?.[claim.kind];
  return own && own > 0 ? { amount: own, basis: "owner" } : null;
}

/** The driver's share of extra pay for their work: what the owner set, else a percentage driver's percentage. */
export function extraShare(driver: Pick<Driver, "payType" | "payRate" | "extraShare">): number {
  if (driver.extraShare !== undefined) return Math.max(0, Math.min(1, driver.extraShare));
  return driver.payType === "percentage" ? driver.payRate : 0;
}

/** Pay-run lines for the driver's share of the extra pay claimed on a load. */
export function extraPayLines(load: Pick<Load, "referenceNumber" | "extraClaims">, driver: Pick<Driver, "payType" | "payRate" | "extraShare">, teamSplit = false): { label: string; amount: number }[] {
  const share = extraShare(driver) / (teamSplit ? 2 : 1);
  if (share <= 0) return [];
  return (load.extraClaims ?? [])
    .filter((c) => c.sentAt && c.amount && DRIVER_WORK.includes(c.kind))
    .map((c) => ({ label: `${EXTRA_LABEL[c.kind].split(" (")[0]} on ${load.referenceNumber}`, amount: Math.round(c.amount! * share * 100) / 100 }));
}

// ─── Breakdowns ──────────────────────────────────────────────────────────────

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3 };

/** "About 90 minutes" → 1.5, "2-3 hours" → 3, "tomorrow morning" → 16. Null when the shop didn't say. */
export function etaHours(said: string | null | undefined): number | null {
  if (!said) return null;
  const t = said.toLowerCase();
  if (/\b(tomorrow|next day|in the morning|overnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)) return /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t) ? 24 : 16;
  if (/half an hour/.test(t)) return 0.5;
  const hours = [...t.matchAll(/(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|couple|few)(?:\s*(?:-|to)\s*(\d+))?\s*(?:of\s+)?(hours?|hrs?|minutes?|mins?)\b/g)];
  if (!hours.length) return /\b(right now|on (?:the|our) way|asap|shortly|soon)\b/.test(t) ? 1 : null;
  const m = hours[hours.length - 1];
  const n = Number(m[2] ?? (NUM[m[1]] ?? m[1]));
  if (!Number.isFinite(n)) return null;
  return /^min/.test(m[3]) ? Math.round((n / 60) * 10) / 10 : n;
}

/** The repair won't be done today: nobody could come, the shop said hours away or tomorrow, or three hours went by with no shop. */
export function longBreakdown(r: Pick<Roadside, "at" | "found" | "exhausted">, now: number): string | null {
  if (r.exhausted) return "no repair shop or tow could come";
  const eta = etaHours(r.found?.eta);
  if (r.found && eta !== null && eta >= 6) return `the shop said ${r.found.eta}`;
  if (!r.found && now - Date.parse(r.at) >= 3 * 3600_000) return "no shop has taken it in three hours";
  return null;
}

const where = (t: Pick<Truck, "position" | "currentCity" | "currentState">): LatLng | undefined =>
  t.position ? [t.position.lat, t.position.lon] : placeCoords(t.currentCity, t.currentState);

/**
 * Another truck of the carrier's that could pick the load up (a repower): same trailer type, a driver, nothing on
 * it now, and within 300 road miles of the broken one. The closest, or null.
 */
export function recoveryTruck(broken: Truck, trucks: Truck[], loads: Pick<Load, "id" | "stage">[], now: number): { truck: Truck; miles: number } | null {
  const from = where(broken);
  if (!from) return null;
  const busy = new Set(loads.filter((l) => ["dispatched", "at_pickup", "in_transit", "at_delivery"].includes(l.stage)).map((l) => l.id));
  let best: { truck: Truck; miles: number } | null = null;
  for (const t of trucks) {
    if (t.id === broken.id || t.equipmentType !== broken.equipmentType || !t.driverId || t.status === "maintenance") continue;
    // Broken down itself in the last day.
    if (t.roadside && now - Date.parse(t.roadside.at) < 24 * 3600_000) continue;
    if (t.currentLoadId && busy.has(t.currentLoadId)) continue;
    const at = where(t);
    if (!at) continue;
    const miles = Math.round(roadMiles(from, at));
    if (miles <= 300 && (!best || miles < best.miles)) best = { truck: t, miles };
  }
  return best;
}

// ─── Wrong way ───────────────────────────────────────────────────────────────

/**
 * A truck getting farther from the stop it's heading to, reading over reading: more than 10 miles farther in 15 to
 * 90 minutes, when it wasn't already at the stop. Returns how many miles farther, or null.
 */
export function wrongWay(before: { miles: number; at: string } | undefined, miles: number, now: number): number | null {
  if (!before) return null;
  const mins = (now - Date.parse(before.at)) / 60_000;
  if (mins < 15 || mins > 90 || before.miles < 15) return null;
  const farther = Math.round(miles - before.miles);
  return farther >= 10 ? farther : null;
}
