import type { Broker, Driver, Load, Truck, TruckGear } from "../types";
import { hourAtStop, isoToStopLocal } from "../stop-time";

/**
 * The calls a seasoned dispatcher makes in a glance, written down: what makes a load worth more than the lane's usual
 * (a weekend pickup, a load that has to go in hours, hazmat, high-value freight), what makes one smell wrong (paying
 * far over the market, asking for money first), a load a driver won't run (a city they avoid, touch freight they said
 * no to, gear the truck doesn't carry), a broker reposting the same load higher, and the same load from two brokers.
 * No I/O: the booking flow (lib/agent/booking) asks these and acts.
 */

const HOUR = 3600_000;
const round25 = (n: number) => Math.ceil(n / 25) * 25;

/** The kinds of gear a load can ask for, and the words that ask for them. */
export const GEAR: { id: TruckGear; label: string; words: RegExp }[] = [
  { id: "tarps", label: "tarps", words: /\btarp(s|ped|ping)?\b/i },
  { id: "straps", label: "straps", words: /\bstraps?\b/i },
  { id: "chains", label: "chains and binders", words: /\bchains?\b(?! of custody)|\bbinders?\b/i },
  { id: "load_locks", label: "load locks or bars", words: /\bload (locks?|bars?)\b|\blogistics? (bars?|straps?)\b|\be-?track\b/i },
  { id: "pallet_jack", label: "a pallet jack", words: /\bpallet jack\b/i },
  { id: "liftgate", label: "a liftgate", words: /\blift ?gate\b/i },
  { id: "ppe", label: "safety gear (vest, hard hat, boots)", words: /\b(ppe|hard ?hat|steel[- ]toe|safety (vest|glasses|boots))\b/i },
];

/** Gear the load's notes ask for, in the order of the list above. */
export function gearAsked(text: string | null | undefined): TruckGear[] {
  if (!text) return [];
  return GEAR.filter((g) => g.words.test(text)).map((g) => g.id);
}

/** What the truck is missing for this load, only when the owner listed the truck's gear (no list: no guessing). */
export function gearMissing(truck: Pick<Truck, "gear">, text: string | null | undefined): string[] {
  if (!truck.gear) return [];
  return gearAsked(text).filter((g) => !truck.gear!.includes(g)).map((g) => GEAR.find((x) => x.id === g)!.label);
}

/** The driver loads or unloads the freight by hand, or helps the dock do it. */
export const touchFreight = (text: string | null | undefined) =>
  !!text && /\b(driver (assist|unload|load|count)s?|touch freight|hand ?(un)?load(ed|ing)?|floor[- ]?load(ed)?|fingerprint|driver must (un)?load|lumper not (provided|available))\b/i.test(text);

/** Freight a thief wants, or that costs a lot when it goes wrong: worth more, and worth watching. */
export const highValue = (text: string | null | undefined) =>
  !!text && /\b(electronics?|tvs?|televisions?|laptops?|phones?|computers?|pharma(ceutical)?s?|medic(ine|ation)s?|alcohol|liquor|wine|beer|spirits|tobacco|cigarettes?|copper|tires?|energy drinks?|nuts|seafood|meat|high[- ]value)\b/i.test(text);

export const hazmatText = (text: string | null | undefined) => !!text && /\b(haz ?mat|hazardous|placard(ed|s)?|un ?\d{4}|class [1-9]\b)/i.test(text);

/** A load's day at the pickup: 0 Sunday … 6 Saturday, in the dock's own time zone. Null without a time. */
export function pickupWeekday(pickupAt: string | null | undefined, state: string): number | null {
  if (!pickupAt) return null;
  const local = isoToStopLocal(pickupAt, state);
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : null;
}

export interface Premium {
  /** What the opening number is multiplied by: 1 when nothing applies. Never more than MAX_PREMIUM. */
  factor: number;
  /** In the owner's words, for the load's why ("weekend pickup", "hazmat"). */
  reasons: string[];
}

/** No load is asked more than this much over its price for these reasons together. */
export const MAX_PREMIUM = 1.18;

/**
 * What a dispatcher asks extra for, and why: a weekend pickup (the driver gives up a weekend and the dock is often
 * slow), a load that has to move within the day (the broker is short of trucks), hazmat (the endorsement, the
 * placards, the insurance), high-value freight (theft risk and the cargo coverage it needs), and a load the driver has
 * to touch. Each is a small step; together they're capped.
 */
export function askPremiums(o: { pickupAt?: string | null; originState: string; hazmat?: boolean | null; notes?: string | null; commodity?: string | null }, now: number): Premium {
  const reasons: string[] = [];
  let pct = 0;
  const text = [o.notes, o.commodity].filter(Boolean).join(" ");
  const day = pickupWeekday(o.pickupAt, o.originState);
  if (day === 0 || day === 6) {
    pct += 5;
    reasons.push("weekend pickup");
  }
  // Short notice: the broker needs a truck now. Next-day freight is normal, so only within hours counts.
  const lead = o.pickupAt ? Date.parse(o.pickupAt) - now : null;
  if (lead !== null && lead > 0 && lead <= 6 * HOUR) {
    pct += 6;
    reasons.push("picks up within 6 hours");
  }
  if (o.hazmat || hazmatText(text)) {
    pct += 10;
    reasons.push("hazmat");
  }
  if (highValue(text)) {
    pct += 5;
    reasons.push("high-value freight");
  }
  if (touchFreight(text)) {
    pct += 4;
    reasons.push("driver handles the freight");
  }
  return { factor: Math.min(MAX_PREMIUM, 1 + pct / 100), reasons };
}

/** The ask with the premiums on it, in steps of $25. */
export const withPremium = (ask: number, p: Premium) => (p.factor > 1 ? round25(ask * p.factor) : ask);

/**
 * What makes a load look wrong before anyone answers it: a rate far over the market (the classic bait: a great load
 * that turns into a fee, a double broker or a theft), and a poster asking for money, a gift card or a wire first.
 * Each line is for the owner; any of them keeps the AI from asking for the load on its own.
 */
export function redFlags(o: { rate: number | null; miles: number; notes?: string | null }, market?: { rpm: number } | null): string[] {
  const out: string[] = [];
  const rpm = o.rate && o.miles ? o.rate / o.miles : null;
  if (rpm && market?.rpm && rpm >= market.rpm * 1.6 && o.miles >= 150)
    out.push(`Pays $${rpm.toFixed(2)} a mile, about ${(rpm / market.rpm).toFixed(1)}× the market ($${market.rpm.toFixed(2)}). Loads that good are often bait for a scam: check the broker by phone at the number on FMCSA before booking.`);
  else if (rpm && !market?.rpm && rpm >= 7 && o.miles >= 300)
    out.push(`Pays $${rpm.toFixed(2)} a mile over ${Math.round(o.miles)} miles, far over what freight usually pays. Check the broker by phone at the number on FMCSA before booking.`);
  if (o.notes && /\b(deposit|(processing|setup|registration|insurance|dispatch) fee|pay (a |the )?fee|upfront|advance fee|gift ?cards?|wire (the )?(money|funds|payment)|zelle|cash ?app|crypto|bitcoin)\b/i.test(o.notes))
    out.push("The post asks the carrier to pay something first (a fee, a deposit, a wire or a gift card). Real brokers never do: this is a scam until proven otherwise.");
  return out;
}

/** Why this driver won't run this load, from what they told us: a city they avoid, touch freight they said no to. */
export function driverWontRun(driver: Pick<Driver, "prefs"> | undefined, o: { originCity: string; destinationCity: string; notes?: string | null }): string | null {
  const prefs = driver?.prefs;
  if (!prefs) return null;
  const avoid = (prefs.avoidCities ?? []).map((c) => c.toLowerCase().trim());
  const hit = [o.originCity, o.destinationCity].find((c) => avoid.includes(c.toLowerCase().trim()));
  if (hit) return `doesn't go to ${hit}`;
  if (prefs.noTouchFreight && touchFreight(o.notes)) return "doesn't do touch freight";
  return null;
}

/**
 * The same load posted again by the same broker: how many times, and whether it now pays more. A broker reposting a
 * load is having trouble covering it, which is room to ask more; reposting it higher is the moment to come back to a
 * load we walked away from.
 */
export function repostOf(existing: Pick<Load, "listedRate" | "repostCount">, newRate: number | null): { count: number; higher: boolean } {
  return { count: (existing.repostCount ?? 0) + 1, higher: !!newRate && newRate > (existing.listedRate || 0) };
}

/** A repeat post earns a little more on the ask: 3% from the second time it's posted, 6% from the third. */
export const repostPremium = (count: number): Premium =>
  count >= 2 ? { factor: 1.06, reasons: [`posted ${count + 1} times, so the broker is short of trucks`] } : count >= 1 ? { factor: 1.03, reasons: ["posted again, so the broker is short of trucks"] } : { factor: 1, reasons: [] };

/**
 * The same freight from another broker: the same lane, picking up within three hours of each other. A dispatcher
 * takes the better paying one and lets the other go; booking both would double-book the truck.
 */
export function twinOf(loads: Load[], o: { brokerId: string; originCity: string; destinationCity: string; pickupAt?: string | null }): Load | undefined {
  if (!o.pickupAt) return undefined;
  const at = Date.parse(o.pickupAt);
  return loads.find(
    (l) =>
      l.brokerId !== o.brokerId &&
      ["offered", "negotiating"].includes(l.stage) &&
      l.lane.origin.toLowerCase() === o.originCity.toLowerCase() &&
      l.lane.destination.toLowerCase() === o.destinationCity.toLowerCase() &&
      !!l.pickupAt &&
      Math.abs(Date.parse(l.pickupAt) - at) <= 3 * HOUR,
  );
}

/** Of two twins, the one worth asking for: the higher rate; on a tie, the broker who pays faster. */
export function betterTwin(a: Load, b: Load, brokers: Pick<Broker, "id" | "avgDaysToPay">[]): Load {
  const rate = (l: Load) => l.listedRate || l.targetRate || 0;
  if (rate(a) !== rate(b)) return rate(a) > rate(b) ? a : b;
  const days = (l: Load) => brokers.find((x) => x.id === l.brokerId)?.avgDaysToPay ?? 99;
  return days(a) <= days(b) ? a : b;
}

/**
 * What the carrier's own history and the load's situation add on top (lib/agent/booking puts them with the rest):
 * a lane paying more lately, a weekday that pays more on it, a broker who rarely pays detention, a dock known to keep
 * trucks long, and a long empty run to the pickup (asked as dollars, the way dispatchers ask for deadhead).
 */
export function situationPremiums(o: {
  trend?: { pct: number } | null;
  weekday?: { pct: number; day: string } | null;
  detentionPaidPct?: number | null;
  slowDockHours?: number | null;
  deadheadMiles?: number;
  loadedMiles?: number;
}): Premium & { deadheadDollars: number } {
  const reasons: string[] = [];
  let pct = 0;
  if (o.trend && o.trend.pct >= 5) {
    pct += 3;
    reasons.push(`lane paying ${o.trend.pct}% more lately`);
  }
  if (o.weekday && o.weekday.pct >= 8) {
    pct += 4;
    reasons.push(`${o.weekday.day} pickups pay more on this lane`);
  }
  if (o.detentionPaidPct != null && o.detentionPaidPct < 50) {
    pct += 3;
    reasons.push("broker rarely pays detention");
  }
  if (o.slowDockHours && o.slowDockHours >= 3) {
    pct += 4;
    reasons.push(`a dock that keeps trucks about ${o.slowDockHours} hours`);
  }
  // Empty miles worth paying for: a long run to the pickup, compared to the load itself.
  const dh = o.deadheadMiles ?? 0;
  const deadheadDollars = dh >= 150 && o.loadedMiles && dh > o.loadedMiles * 0.4 ? round25(dh * 0.75) : 0;
  if (deadheadDollars) reasons.push(`${Math.round(dh)} empty miles to the pickup`);
  return { factor: 1 + pct / 100, reasons, deadheadDollars };
}

/**
 * A lane the owner won't run, from Settings: "TX>CA" (that lane), ">CA" (into California from anywhere) or "NY>" (out
 * of New York). The entry it matched, or null.
 */
export function laneAvoided(avoid: string[] | undefined, o: { originState: string; destinationState: string }): string | null {
  for (const raw of avoid ?? []) {
    const [from, to] = raw.toUpperCase().replace(/\s/g, "").split(">");
    if ((!from || from === o.originState.toUpperCase()) && (!to || to === o.destinationState.toUpperCase()) && (from || to)) return raw;
  }
  return null;
}

/** A load that would run on a day the owner blocked for this truck (YYYY-MM-DD, the truck home or in the shop). */
export function dayBlocked(blocked: string[] | undefined, pickupAt: number | null, miles: number): string | null {
  if (!blocked?.length || !pickupAt) return null;
  // Pickup day through the day it should deliver, at about 500 miles a day.
  const days = Math.floor(miles / 500);
  for (let i = 0; i <= days; i++) {
    const d = new Date(pickupAt + i * 86400_000).toISOString().slice(0, 10);
    if (blocked.includes(d)) return d;
  }
  return null;
}

/** A pickup earlier in the day than the driver said they start (their local hour at the dock). */
export function beforeStart(startAfter: number | undefined, pickupAt: number | null, originState: string): boolean {
  if (startAfter == null || !pickupAt) return false;
  return hourAtStop(originState, pickupAt) < startAfter;
}
