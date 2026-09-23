import type { Load } from "./types";

/** Stages where a load's rate is locked — it's real money for the week, not a quote. */
const EARNING_STAGES = new Set(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"]);

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Rough hands-on time a human dispatcher spends per piece of work the AI did instead. */
const DISPATCHER_MINUTES = { perLoad: 35, perMessage: 6, perCall: 12, perDocument: 8 };

export interface WeekEarnings {
  loads: Load[];
  gross: number;
  net: number;
  loadedMiles: number;
  emptyMiles: number;
  /** Revenue per mile over every mile driven, empty ones included — the number that pays the bills. */
  rpmAll: number;
  rpmLoaded: number;
  emptyPct: number;
  /** What the AI booked above the lane's market rate. */
  overMarket: number;
  /** What the AI negotiated above the brokers' posted rates. */
  overPosted: number;
  /** Detention and other extras the AI billed. */
  extras: number;
  /** Human dispatcher hours the AI's work replaced. */
  hoursSaved: number;
  byDay: { day: string; gross: number; net: number }[];
}

export function isEarningLoad(load: Load): boolean {
  return EARNING_STAGES.has(load.stage) && load.bookedRate !== null;
}

/** The week's money for a set of loads (one truck's, or the whole fleet's). */
export function weekEarnings(allLoads: Load[]): WeekEarnings {
  const loads = allLoads.filter(isEarningLoad);
  const gross = loads.reduce((s, l) => s + (l.bookedRate ?? 0), 0);
  const extras = loads.reduce((s, l) => s + (l.accessorials ?? []).reduce((a, x) => a + x.amount, 0), 0);
  const net = loads.reduce((s, l) => s + (l.netProfit ?? 0), 0);
  const loadedMiles = loads.reduce((s, l) => s + l.lane.miles, 0);
  const emptyMiles = loads.reduce((s, l) => s + l.deadheadMiles, 0);
  const totalMiles = loadedMiles + emptyMiles;
  const overMarket = loads.reduce((s, l) => s + ((l.bookedRate ?? 0) - Math.round(l.lane.miles * l.lane.marketRpm)), 0);
  const overPosted = loads.reduce((s, l) => s + Math.max(0, (l.bookedRate ?? 0) - l.listedRate), 0);
  const minutes = loads.reduce(
    (s, l) =>
      s +
      DISPATCHER_MINUTES.perLoad +
      l.messages.filter((m) => m.direction === "outbound").length * DISPATCHER_MINUTES.perMessage +
      l.calls.length * DISPATCHER_MINUTES.perCall +
      l.documents.length * DISPATCHER_MINUTES.perDocument,
    0,
  );

  const byDay = DAY_LABELS.map((day) => ({ day, gross: 0, net: 0 }));
  for (const l of loads) {
    const idx = (new Date(l.createdAt).getDay() + 6) % 7;
    byDay[idx].gross += l.bookedRate ?? 0;
    byDay[idx].net += l.netProfit ?? 0;
  }

  return {
    loads,
    gross: gross + extras,
    net,
    loadedMiles,
    emptyMiles,
    rpmAll: totalMiles ? (gross + extras) / totalMiles : 0,
    rpmLoaded: loadedMiles ? gross / loadedMiles : 0,
    emptyPct: totalMiles ? (emptyMiles / totalMiles) * 100 : 0,
    overMarket,
    overPosted,
    extras,
    hoursSaved: Math.round(minutes / 60),
    byDay,
  };
}
