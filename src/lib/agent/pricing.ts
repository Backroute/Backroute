import type { AgentSettings } from "../store";
import type { Load } from "../types";

/**
 * The money rules, in code rather than in the AI's instructions, so a broker's email can't talk the AI below them:
 * the AI reads the numbers, and these decide what to ask. What to answer a broker's number is lib/agent/negotiation.
 */

const round25 = (n: number) => Math.ceil(n / 25) * 25;

/** The lowest total the carrier takes for this load: their lowest rate per mile times its loaded miles. */
/** The key a lane's own lowest rate is kept under: "TX>TN". */
export const laneKey = (lane: Pick<Load["lane"], "originState" | "destState">) => `${lane.originState.toUpperCase()}>${lane.destState.toUpperCase()}`;

/** The lowest the AI goes on a load: the owner's lowest rate a mile, or their own number for that lane if higher. */
export function floorFor(load: Pick<Load, "lane">, settings: Pick<AgentSettings, "minRpm" | "laneFloors">): number | null {
  const rpm = Math.max(settings.minRpm ?? 0, settings.laneFloors?.[laneKey(load.lane)] ?? 0);
  return rpm ? round25(rpm * load.lane.miles) : null;
}

/** How a broker has dealt with this carrier before (lib/agent/memory), for pricing the next load with them. */
export interface BrokerHabits {
  /** Loads hauled for them, and what they paid on average per mile. */
  booked: number;
  avgRpm: number | null;
  /** How often they took our first number as it was, and how often they pushed back. */
  tookOurAsk: number;
  countered: number;
}

/**
 * What to open at for a load a broker posted. A dispatcher opens with room to come down, the way people haggle: a bit
 * over a post that already pays, and well over the carrier's lowest when the post is under it, so the counters
 * (lib/agent/negotiation) have somewhere to go. With no posted rate, the floor plus a quarter. Never under the floor,
 * and never past the top of what the lane pays today when a rate service knows it.
 *
 * Then what this carrier knows: what it got on this lane before, what the market says, and how this broker deals (what
 * they've paid before; a broker who always says yes to the first number is being asked too little; one who always
 * pushes back expects room). Null when there's nothing to go on (no floor and no posted rate): the owner names the price.
 */
export function askFor(
  load: Pick<Load, "lane" | "listedRate">,
  settings: Pick<AgentSettings, "minRpm">,
  lane?: { count: number; avgRpm: number | null },
  market?: { rpm: number; high?: number } | null,
  broker?: BrokerHabits | null,
): number | null {
  const floor = floorFor(load, settings);
  const posted = load.listedRate > 0 ? load.listedRate : null;
  let ask: number | null = null;
  if (posted && floor) ask = posted >= floor ? round25(Math.max(posted * 1.08, posted + 75)) : round25(Math.max(floor * 1.12, posted * 1.2));
  else if (posted) ask = round25(Math.max(posted * 1.08, posted + 75));
  else if (floor) ask = round25(floor * 1.25);
  // The carrier has hauled this lane for more, more than once: ask for what it usually gets, up to 15% over the post.
  if (lane?.avgRpm && lane.count >= 2) {
    const usual = round25(lane.avgRpm * load.lane.miles);
    const cap = posted ? round25(posted * 1.15) : usual;
    ask = Math.max(ask ?? 0, Math.min(usual, cap));
  }
  // This broker has paid more before, on loads we hauled for them: at least that, up to 20% over the post.
  if (broker?.avgRpm && broker.booked >= 2) {
    const paid = round25(broker.avgRpm * load.lane.miles);
    ask = Math.max(ask ?? 0, Math.min(paid, posted ? round25(posted * 1.2) : paid));
  }
  if (ask && broker) {
    // Says yes to our first number every time: we've been asking too little. Always pushes back: leave room.
    if (broker.tookOurAsk >= 2 && broker.countered === 0) ask = round25(ask * 1.05);
    else if (broker.countered >= 2 && broker.tookOurAsk === 0) ask = round25(ask * 1.04);
  }
  if (market?.rpm) {
    const average = round25(market.rpm * load.lane.miles);
    const top = market.high ? round25(market.high * load.lane.miles) : round25(average * 1.1);
    // The market pays more than we'd ask: open at its average. Asking past its top just loses the load.
    ask = Math.min(Math.max(ask ?? 0, average), top);
  }
  return ask && floor ? Math.max(ask, floor) : ask;
}

/**
 * Dollar amounts written in a message, however they're written: "$2,450", "$ 75", "$2450.00", "$2.4k", "2,450 dollars",
 * "2450 bucks", "USD 2450". Cents are dropped. Used to keep any price the AI didn't get from the rules out of its words.
 */
export function dollarAmounts(text: string): number[] {
  const out: number[] = [];
  const num = (whole: string, frac: string | undefined, k: string | undefined) => {
    const n = Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);
    return Math.floor(k ? n * 1000 : n);
  };
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(\d{1,2}))?(\s?[kK]\b)?/g)) out.push(num(m[1], m[3] ? m[2] : undefined, m[3]));
  for (const m of text.matchAll(/(?<![$\d.,])(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(\d{1,2}))?(\s?[kK])?\s?(?:dollars|bucks|usd)\b/gi)) out.push(num(m[1], m[3] ? m[2] : undefined, m[3]));
  for (const m of text.matchAll(/\busd\s?(\d{1,3}(?:,\d{3})+|\d{1,6})/gi)) out.push(num(m[1], undefined, undefined));
  return out;
}

/** An email address said out loud ("kim at t q l dot com", "kim underscore b at tql dot com"), written out. */
export function spokenEmail(said: string): string {
  return said
    .trim()
    .toLowerCase()
    .replace(/\s+(?:at)\s+/g, "@")
    .replace(/\s+(?:dot|period)\s+/g, ".")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s+(?:dash|hyphen)\s+/g, "-")
    .replace(/\s/g, "")
    .replace(/[.,]$/, "");
}

/**
 * A reply the AI wrote freely (not from a template) may only repeat prices already in the conversation or on the
 * load. One that names a new number goes to the owner instead of out the door, even on full autopilot.
 */
export function onlyKnownPrices(body: string, known: number[]): boolean {
  return dollarAmounts(body).every((n) => known.includes(n));
}
