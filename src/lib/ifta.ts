import type { Load } from "./types";

/** Compliance & IFTA AI: estimates miles run per state from lane data (half attributed to origin, half to destination —
 *  a reasonable approximation without full routing/ELD breadcrumb data), and the quarterly fuel tax it implies. */
export interface StateMiles {
  state: string;
  miles: number;
}

export function estimateMilesByState(loads: Load[]): StateMiles[] {
  const totals = new Map<string, number>();
  for (const load of loads) {
    const half = load.lane.miles / 2;
    totals.set(load.lane.originState, (totals.get(load.lane.originState) ?? 0) + half);
    totals.set(load.lane.destState, (totals.get(load.lane.destState) ?? 0) + half);
  }
  return Array.from(totals.entries())
    .map(([state, miles]) => ({ state, miles: Math.round(miles) }))
    .sort((a, b) => b.miles - a.miles);
}

/** Blended average net IFTA rate across states — a placeholder estimate, not a filing-ready figure. */
export const IFTA_NET_RATE_PER_GALLON = 0.24;

export function estimateFuelTaxOwed(totalMiles: number, avgMpg: number): number {
  const gallons = totalMiles / avgMpg;
  return Math.round(gallons * IFTA_NET_RATE_PER_GALLON);
}
