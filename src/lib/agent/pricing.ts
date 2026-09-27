import type { AgentSettings } from "../store";
import type { Load } from "../types";

/**
 * The money rules, in code rather than in the AI's instructions, so a broker's email can't talk the AI below them:
 * the AI reads the numbers, and these decide what to ask. What to answer a broker's number is lib/agent/negotiation.
 */

const round25 = (n: number) => Math.ceil(n / 25) * 25;

/** The lowest total the carrier takes for this load: their lowest rate per mile times its loaded miles. */
export function floorFor(load: Pick<Load, "lane">, settings: Pick<AgentSettings, "minRpm">): number | null {
  return settings.minRpm ? round25(settings.minRpm * load.lane.miles) : null;
}

/**
 * What to ask a broker for a load they posted. Dispatchers ask a little over the posted rate; never under the floor.
 * Null when there's nothing to go on (no floor and no posted rate): the owner names the price.
 */
export function askFor(load: Pick<Load, "lane" | "listedRate">, settings: Pick<AgentSettings, "minRpm">, lane?: { count: number; avgRpm: number | null }, market?: { rpm: number; high?: number } | null): number | null {
  const floor = floorFor(load, settings);
  const posted = load.listedRate > 0 ? load.listedRate : null;
  let ask: number | null = null;
  if (posted && floor) ask = Math.max(floor, round25(posted * 1.05));
  else if (posted) ask = round25(posted * 1.05);
  else if (floor) ask = round25(floor * 1.12);
  // The carrier has hauled this lane for more, more than once: ask for what it usually gets, up to 15% over the post.
  if (lane?.avgRpm && lane.count >= 2) {
    const usual = round25(lane.avgRpm * load.lane.miles);
    const cap = posted ? round25(posted * 1.15) : usual;
    ask = Math.max(ask ?? 0, Math.min(usual, cap));
  }
  // The market pays more than the post: open at the market average, never past the top of its range.
  if (market?.rpm) {
    const average = round25(market.rpm * load.lane.miles);
    const top = market.high ? round25(market.high * load.lane.miles) : round25(average * 1.1);
    ask = Math.max(ask ?? 0, Math.min(average, top));
  }
  return ask;
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
