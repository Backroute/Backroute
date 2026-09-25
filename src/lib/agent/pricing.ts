import type { AgentSettings } from "../store";
import type { Load } from "../types";

/**
 * The money rules, in code rather than in the AI's instructions, so a broker's email can't talk the AI below them:
 * the AI reads the numbers, and these decide what to ask, take, or pass to the owner.
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
export function askFor(load: Pick<Load, "lane" | "listedRate">, settings: Pick<AgentSettings, "minRpm">, lane?: { count: number; avgRpm: number | null }): number | null {
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
  return ask;
}

export type Answer = { action: "accept"; amount: number } | { action: "counter"; amount: number } | { action: "owner"; why: string };

/**
 * A broker answered our ask with a number. At or above the floor: take it. Below: counter once at the floor.
 * Below again, or no floor set: the owner decides. The AI never agrees to less than the floor.
 */
export function answerBroker(offer: number, load: Pick<Load, "lane">, settings: Pick<AgentSettings, "minRpm">, counteredBefore: boolean): Answer {
  const floor = floorFor(load, settings);
  if (!floor) return { action: "owner", why: `No lowest rate per mile is set, so the AI won't agree to $${offer.toLocaleString()} on its own.` };
  if (offer >= floor) return { action: "accept", amount: offer };
  if (!counteredBefore) return { action: "counter", amount: floor };
  return { action: "owner", why: `The broker's $${offer.toLocaleString()} is under your lowest ($${floor.toLocaleString()} at $${settings.minRpm!.toFixed(2)}/mile), after one counter.` };
}

/** Dollar amounts written in a message, e.g. "$2,450", "$ 75" or "$2450.00". */
export function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d{2})?/g)].map((m) => Number(m[1].replace(/,/g, "")));
}

/**
 * A reply the AI wrote freely (not from a template) may only repeat prices already in the conversation or on the
 * load. One that names a new number goes to the owner instead of out the door, even on full autopilot.
 */
export function onlyKnownPrices(body: string, known: number[]): boolean {
  return dollarAmounts(body).every((n) => known.includes(n));
}
