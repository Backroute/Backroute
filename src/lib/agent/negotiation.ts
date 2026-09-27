import type { AgentSettings } from "../store";
import type { Load } from "../types";
import { floorFor } from "./pricing";

/**
 * How the AI haggles, the way a good dispatcher does, with every number decided here in code (never by the AI's
 * words, so a broker can't talk it anywhere):
 *
 * - It opens at the ask (lib/agent/pricing) and comes down in steps: about a third of the way toward where it's
 *   willing to end up, then two thirds, then most of the rest. Up to three counters.
 * - Where it's willing to end up: the owner's lowest, or 90% of what the lane pays today when a rate service is
 *   connected (whichever is more), or the broker's number when that's already better.
 * - If the broker doesn't move, neither does it.
 * - Close enough to our number (within $50 or 3%): it takes it.
 * - After three counters: at or over the owner's lowest it takes it; within 5% under, the owner decides; further
 *   under, it passes politely and leaves the door open.
 * - Every counter comes with a reason a broker understands (the market, the empty miles, a hard place to reload,
 *   being ready on time), a different one each round when there's more than one, the way people don't repeat
 *   themselves.
 * - When the two numbers are close (within about 12%) after a round, it offers to meet in the middle.
 */

export const MAX_COUNTERS = 3;
const STEPS = [0.3, 0.6, 0.85];

const round25 = (n: number) => Math.ceil(n / 25) * 25;
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export type BookRequest = NonNullable<Load["bookRequest"]>;

export type Move =
  | { action: "accept"; amount: number }
  | { action: "counter"; amount: number; round: number; final: boolean; held: boolean; split?: boolean; reason: string }
  | { action: "owner"; why: string }
  | { action: "pass"; amount: number; why: string };

/** Close enough to our number to just take it. */
const closeEnough = (offer: number, ours: number) => offer >= ours - Math.max(50, ours * 0.03);

/** Where the AI is willing to end up: the owner's lowest, or 90% of what the lane pays today if that's more. */
export function targetFor(load: Pick<Load, "lane" | "market">, settings: Pick<AgentSettings, "minRpm">): number | null {
  const floor = floorFor(load, settings);
  if (!floor) return null;
  const market = load.market?.rpm ? round25(0.9 * load.market.rpm * load.lane.miles) : 0;
  return Math.max(floor, market);
}

/** Counters made so far (older loads only have the countered flag). */
export const roundsOf = (req: Load["bookRequest"]) => req?.rounds ?? (req?.countered ? 1 : 0);

type ReasonLoad = Pick<Load, "lane" | "market" | "deadheadMiles" | "pickupAt" | "reloadMarket">;

/** Every reason for our number that holds for this load, most persuasive first. Numbers come from the load. */
export function reasonsFor(load: ReasonLoad, amount: number, now = Date.now()): string[] {
  const out: string[] = [];
  if (load.market?.rpm && amount <= round25(load.market.rpm * load.lane.miles * 1.1)) out.push(`Lanes like this are paying about $${load.market.rpm.toFixed(2)} a mile right now.`);
  if (load.deadheadMiles >= 75) out.push(`We're running ${Math.round(load.deadheadMiles)} miles empty to get to it.`);
  if (load.reloadMarket === "weak") out.push(`${load.lane.destination} is a tough place to reload, so we'll likely leave there empty.`);
  const pickup = load.pickupAt ? Date.parse(load.pickupAt) : NaN;
  if (pickup && pickup - now < 36 * 3600_000 && pickup > now) out.push("The truck is ready and will be there on time.");
  out.push(`That works out to $${(amount / Math.max(1, load.lane.miles)).toFixed(2)} a mile, which is what we need on this lane.`);
  return out;
}

/** The reason for this round: a different one each time, while there are others to give. */
export function reasonFor(load: ReasonLoad, amount: number, round = 1, now = Date.now()): string {
  const all = reasonsFor(load, amount, now);
  return all[(Math.max(1, round) - 1) % all.length];
}

/**
 * The broker named a price (on the phone or by email). What the AI answers, from where the haggling stands.
 * `before` is the book request as it was before this offer.
 */
export function respond(offer: number, load: ReasonLoad & Pick<Load, "targetRate" | "bookRequest">, settings: Pick<AgentSettings, "minRpm">, now = Date.now()): Move {
  const req = load.bookRequest;
  const floor = floorFor(load, settings);
  if (!floor) return { action: "owner", why: `No lowest rate per mile is set, so the AI won't agree to ${money(offer)} on its own.` };
  const ours = req?.ask ?? load.targetRate;
  const opening = Math.max(req?.opening ?? ours, ours);
  const rounds = roundsOf(req);
  const theirsBefore = req?.brokerOffer;

  if (offer >= floor && closeEnough(offer, ours)) return { action: "accept", amount: offer };

  if (rounds >= MAX_COUNTERS) {
    if (offer >= floor) return { action: "accept", amount: offer };
    if (offer >= floor * 0.95) return { action: "owner", why: `After ${rounds} counters the broker is at ${money(offer)}, just under your lowest (${money(floor)} at $${settings.minRpm!.toFixed(2)}/mile).` };
    return { action: "pass", amount: ours, why: `After ${rounds} counters the broker is still at ${money(offer)}, well under your lowest (${money(floor)}).` };
  }

  // They didn't move since last time: hold our number.
  if (rounds > 0 && theirsBefore !== undefined && offer <= theirsBefore) {
    return { action: "counter", amount: ours, round: rounds + 1, final: rounds + 1 >= MAX_COUNTERS, held: true, reason: reasonFor(load, ours, rounds + 1, now) };
  }

  const target = Math.max(targetFor(load, settings) ?? floor, floor);
  const end = Math.max(target, offer);
  let next = round25(opening - STEPS[rounds] * (opening - end));
  next = Math.max(floor, Math.min(next, ours));
  // Our next step would meet them: take their number (when it's one the owner allows).
  if (offer >= floor && next - offer <= Math.max(50, next * 0.03)) return { action: "accept", amount: offer };
  const final = rounds + 1 >= MAX_COUNTERS || next <= floor;
  // Close, after a round of back-and-forth: meet in the middle, when that gives up less than the next step would.
  const middle = round25((ours + offer) / 2);
  if (rounds > 0 && offer >= target && ours - offer <= ours * 0.12 && middle < ours && (middle > next || next >= ours))
    return { action: "counter", amount: middle, round: rounds + 1, final, held: false, split: true, reason: reasonFor(load, middle, rounds + 1, now) };
  return { action: "counter", amount: next, round: rounds + 1, final, held: next === ours && rounds > 0, reason: reasonFor(load, next, rounds + 1, now) };
}

/** The broker's number, on record. */
export function withTheirOffer(before: BookRequest | undefined, fallbackAsk: number, offer: number, via: "email" | "phone"): BookRequest {
  const at = new Date().toISOString();
  const req: BookRequest = before ?? { ask: fallbackAsk, askedAt: at, status: "sent" };
  return { ...req, opening: req.opening ?? req.ask, brokerOffer: offer, history: [...(req.history ?? []), { by: "them", amount: offer, at, via }] };
}

/** Our answer, on record, once it's been said (on the phone, straight away; by email, when it's sent: lib/agent/outbox). */
export function withOurMove(req: BookRequest, move: Move, via: "email" | "phone"): BookRequest {
  const at = new Date().toISOString();
  if (move.action === "counter") return { ...req, ask: move.amount, countered: true, rounds: roundsOf(req) + 1, history: [...(req.history ?? []), { by: "us", amount: move.amount, at, via }] };
  if (move.action === "accept") return { ...req, history: [...(req.history ?? []), { by: "us", amount: move.amount, at, via }] };
  if (move.action === "pass") return { ...req, status: "declined", passedAt: at };
  return req;
}

/** Everything the AI has said yes to on this load: a broker agreeing to any of these books it. */
export function ourNumbers(req: Load["bookRequest"], fallbackAsk: number): number[] {
  return [req?.ask ?? fallbackAsk, req?.opening ?? fallbackAsk, ...(req?.history ?? []).filter((h) => h.by === "us").map((h) => h.amount)];
}

/** What a broker should put on the rate con besides the price: detention and TONU terms, in one line. */
export function termsLine(settings: Pick<AgentSettings, "detentionPerHour" | "tonuFee">): string {
  return `Please show detention at ${money(settings.detentionPerHour ?? 50)}/hour after 2 hours free, and TONU at ${money(settings.tonuFee ?? 150)}, on the rate con.`;
}

/** Our number when the broker asks what we need (or won't name one first): the standing ask and a reason. */
export function ourNumber(load: ReasonLoad & Pick<Load, "targetRate" | "bookRequest">, now = Date.now()): { amount: number; reason: string } {
  const amount = load.bookRequest?.ask ?? load.targetRate;
  return { amount, reason: reasonFor(load, amount, roundsOf(load.bookRequest) + 1, now) };
}
