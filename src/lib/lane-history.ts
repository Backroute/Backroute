import type { Load } from "./types";

/**
 * Your rates against the market on each lane, month by month: whether the AI (and the owner before it) is getting
 * paid what the lane is worth, and which way it's going. A lane is state to state, so a few loads add up to a line.
 */

export interface LanePoint {
  /** yyyy-mm */
  month: string;
  yours: number;
  market: number;
  loads: number;
}

export interface LaneHistory {
  key: string;
  label: string;
  loads: number;
  yours: number;
  market: number;
  /** Your rate over the market's, as a share (+0.06 = 6% over). */
  vsMarket: number;
  points: LanePoint[];
  /** The last month against the first, per mile. */
  trend: number;
}

const BOOKED = new Set(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"]);

/** Rate per loaded mile actually booked, and the market's for that lane at the time. */
function rates(l: Load): { yours: number; market: number } | null {
  if (!BOOKED.has(l.stage) || !l.lane.miles) return null;
  const yours = l.rpm ?? (l.bookedRate ? l.bookedRate / l.lane.miles : null);
  const market = l.market?.rpm ?? l.lane.marketRpm;
  if (!yours || !market) return null;
  return { yours, market };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function laneHistory(loads: Load[], opts: { minLoads?: number } = {}): LaneHistory[] {
  const groups = new Map<string, { label: string; rows: { month: string; yours: number; market: number }[] }>();
  for (const l of loads) {
    const r = rates(l);
    if (!r) continue;
    const key = `${l.lane.originState}-${l.lane.destState}`;
    const g = groups.get(key) ?? { label: `${l.lane.originState} → ${l.lane.destState}`, rows: [] };
    g.rows.push({ month: (l.pickupAt ?? l.createdAt).slice(0, 7), ...r });
    groups.set(key, g);
  }
  const out: LaneHistory[] = [];
  for (const [key, g] of groups) {
    if (g.rows.length < (opts.minLoads ?? 2)) continue;
    const byMonth = new Map<string, { y: number; m: number; n: number }>();
    for (const row of g.rows) {
      const b = byMonth.get(row.month) ?? { y: 0, m: 0, n: 0 };
      b.y += row.yours;
      b.m += row.market;
      b.n += 1;
      byMonth.set(row.month, b);
    }
    const points = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, b]) => ({ month, yours: r2(b.y / b.n), market: r2(b.m / b.n), loads: b.n }));
    const yours = r2(g.rows.reduce((s, x) => s + x.yours, 0) / g.rows.length);
    const market = r2(g.rows.reduce((s, x) => s + x.market, 0) / g.rows.length);
    out.push({ key, label: g.label, loads: g.rows.length, yours, market, vsMarket: market ? r2(yours / market - 1) : 0, points, trend: points.length > 1 ? r2(points[points.length - 1].yours - points[0].yours) : 0 });
  }
  return out.sort((a, b) => b.loads - a.loads);
}
