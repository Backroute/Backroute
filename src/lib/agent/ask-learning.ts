import type { Load } from "../types";

/**
 * Learning what to open at from how the AI's last asks went, the way a dispatcher remembers who always says yes and
 * where they keep losing loads: first with this broker (three answered asks or more), else on this lane with anyone
 * (four or more). It only moves the opening number; the owner's lowest and the market's top still bound it
 * (lib/agent/pricing), and every counter after that follows the same rules (lib/agent/negotiation).
 *
 * - Won nearly every time, at our first number: we're asking too little. Open 5% higher (7% after five in a row).
 * - Lost most of them: we're asking too much. Open lower, toward where the ones we won ended up (3% to 8% lower).
 */

const DAY = 86400_000;
const BOOKED = new Set<Load["stage"]>(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"]);

interface AskOutcome {
  opening: number;
  /** What it booked at, when it did. */
  final: number | null;
  won: boolean;
  at: number;
}

/** How each ask the AI made ended: booked (and at what), or lost (passed, said no, or no answer in three days). */
export function askOutcomes(loads: Load[], match: (l: Load) => boolean, now: number): AskOutcome[] {
  const out: AskOutcome[] = [];
  for (const l of loads) {
    const req = l.bookRequest;
    if (!req || !match(l)) continue;
    const at = Date.parse(req.askedAt);
    if (!at || at < now - 120 * DAY) continue;
    const opening = req.opening ?? req.ask;
    if (!opening) continue;
    const won = req.status === "accepted" || (BOOKED.has(l.stage) && !!l.bookedRate);
    // Lost: the broker said no, we walked away over the price, or they never answered while we waited. A load we set
    // aside ourselves (another one was booked for the truck) says nothing about our number.
    const lost = !won && (req.status === "declined" || !!req.passedAt || (req.status === "sent" && l.stage === "negotiating" && at < now - 3 * DAY));
    if (!won && !lost) continue; // Still going, or not about the price.
    out.push({ opening, final: won ? (l.bookedRate ?? req.brokerOffer ?? req.ask) : null, won, at });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 10);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

interface LearnedAsk {
  factor: number;
  source: "broker" | "lane" | null;
  /** One line for the owner (lib/agent/why), when it changed anything. */
  why: string | null;
}

/** How much to move the opening number for this broker and lane, from how the last asks went. */
export function learnedAsk(loads: Load[], scope: { brokerId?: string | null; brokerName?: string; lane: Pick<Load["lane"], "originState" | "destState"> }, now: number): LearnedAsk {
  const sameLane = (l: Load) => l.lane.originState === scope.lane.originState && l.lane.destState === scope.lane.destState;
  const byBroker = scope.brokerId ? askOutcomes(loads, (l) => l.brokerId === scope.brokerId, now) : [];
  const [outcomes, source] = byBroker.length >= 3 ? [byBroker, "broker" as const] : [askOutcomes(loads, sameLane, now), "lane" as const];
  if (source === "lane" && outcomes.length < 4) return { factor: 1, source: null, why: null };
  const wins = outcomes.filter((o) => o.won);
  const who = source === "broker" ? (scope.brokerName ?? "this broker") : `brokers on ${scope.lane.originState} → ${scope.lane.destState}`;
  const kept = median(wins.map((o) => (o.final ?? o.opening) / o.opening));
  const n = outcomes.length;
  if (wins.length / n >= 0.8 && (kept ?? 0) >= 0.99) {
    const factor = n >= 5 && wins.length === n ? 1.07 : 1.05;
    return { factor, source, why: `Opened ${Math.round((factor - 1) * 100)}% higher: ${who} took our first number on ${wins.length} of the last ${n} asks.` };
  }
  if (wins.length / n <= 0.4) {
    const factor = Math.min(0.97, Math.max(0.92, kept ?? 0.95));
    return { factor, source, why: `Opened ${Math.round((1 - factor) * 100)}% lower: we lost ${n - wins.length} of the last ${n} asks with ${who} at our first number.` };
  }
  return { factor: 1, source, why: null };
}
