import type { Load } from "./types";

/**
 * Your rates against the market on each lane, month by month: whether the AI (and the owner before it) is getting
 * paid what the lane is worth, and which way it's going. A lane is state to state, so a few loads add up to a line.
 */

export interface LanePoint {
  /** yyyy-mm */
  month: string;
  yours: number;
  /** Null when no load that month has a market rate from a rate service. */
  market: number | null;
  loads: number;
}

export interface LaneHistory {
  key: string;
  label: string;
  loads: number;
  yours: number;
  market: number | null;
  /** Your rate over the market's, as a share (+0.06 = 6% over); null without a market rate. */
  vsMarket: number | null;
  points: LanePoint[];
  /** The last month against the first, per mile. */
  trend: number;
}

const BOOKED = new Set(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"]);

/**
 * Rate per loaded mile actually booked, and the market's for that lane at the time. `serviceOnly`: only a market rate
 * from a rate service counts (a real account), since a load the owner typed in carries its own rate as the lane's.
 */
function rates(l: Load, serviceOnly: boolean): { yours: number; market: number | null } | null {
  if (!BOOKED.has(l.stage) || !l.lane.miles) return null;
  const yours = l.rpm ?? (l.bookedRate ? l.bookedRate / l.lane.miles : null);
  if (!yours) return null;
  const market = l.market?.rpm ?? (serviceOnly ? null : l.lane.marketRpm) ?? null;
  return { yours, market };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? r2(v.reduce((s, x) => s + x, 0) / v.length) : null;
};

export function laneHistory(loads: Load[], opts: { minLoads?: number; serviceOnly?: boolean } = {}): LaneHistory[] {
  const groups = new Map<string, { label: string; rows: { month: string; yours: number; market: number | null }[] }>();
  for (const l of loads) {
    const r = rates(l, !!opts.serviceOnly);
    if (!r) continue;
    const key = `${l.lane.originState}-${l.lane.destState}`;
    const g = groups.get(key) ?? { label: `${l.lane.originState} → ${l.lane.destState}`, rows: [] };
    g.rows.push({ month: (l.pickupAt ?? l.createdAt).slice(0, 7), ...r });
    groups.set(key, g);
  }
  const out: LaneHistory[] = [];
  for (const [key, g] of groups) {
    if (g.rows.length < (opts.minLoads ?? 2)) continue;
    const byMonth = new Map<string, { month: string; yours: number[]; market: (number | null)[] }>();
    for (const row of g.rows) {
      const b = byMonth.get(row.month) ?? { month: row.month, yours: [], market: [] };
      b.yours.push(row.yours);
      b.market.push(row.market);
      byMonth.set(row.month, b);
    }
    const points = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((b) => ({ month: b.month, yours: avg(b.yours)!, market: avg(b.market), loads: b.yours.length }));
    const yours = avg(g.rows.map((x) => x.yours))!;
    const market = avg(g.rows.map((x) => x.market));
    out.push({ key, label: g.label, loads: g.rows.length, yours, market, vsMarket: market ? r2(yours / market - 1) : null, points, trend: points.length > 1 ? r2(points[points.length - 1].yours - points[0].yours) : 0 });
  }
  return out.sort((a, b) => b.loads - a.loads);
}
