import { parseCsv } from "./csv";
import { cityCoords, distanceMiles, nearestCity, type LatLng } from "./trip-geo";
import { STATE_CENTER } from "./us-places";

/**
 * Diesel prices from the carrier's own fuel card: the network price list most cards publish (WEX, Comdata, EFS, AtoB,
 * Mudflap and others), each station with the price the card actually pays. Columns are found by name, so any card's
 * export reads; a station without a usable price or state is skipped and counted.
 */
export interface FuelStation {
  name: string;
  city: string;
  state: string;
  /** What the card pays per gallon (the discounted price when the file has one). */
  price: number;
  /** The pump price, when the file has it. */
  retail?: number;
}

export interface FuelPrices {
  /** "WEX price file" — what the owner uploaded, for the line under the plan. */
  source: string;
  at: string;
  stations: FuelStation[];
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const pick = (header: string[], names: string[]) => header.findIndex((h) => names.includes(norm(h)));
const money = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 1 && n < 15 ? Math.round(n * 1000) / 1000 : null;
};

export function parsePriceFile(text: string): { stations: FuelStation[]; skipped: number } | { error: string } {
  const rows = parseCsv(text.replace(/^﻿/, ""), { separators: ",;\t", trim: true });
  const at = rows.findIndex((r) => r.some((c) => /^(state|st|province)$/i.test(c.trim())));
  if (at < 0) return { error: "No State column. Export the station price list as CSV from the card's site." };
  const header = rows[at];
  const col = {
    name: pick(header, ["station", "stationname", "location", "locationname", "site", "sitename", "truckstop", "merchant", "name", "chain"]),
    city: pick(header, ["city", "town"]),
    state: pick(header, ["state", "st", "province"]),
    net: pick(header, ["yourprice", "netprice", "discountprice", "discountedprice", "cardprice", "price", "cost", "dieselprice", "costplus", "netcost"]),
    retail: pick(header, ["retail", "retailprice", "pumpprice", "pump", "streetprice", "posted", "postedprice"]),
  };
  if (col.net < 0 && col.retail < 0) return { error: "No price column. The file needs a price per gallon for each station." };
  const stations: FuelStation[] = [];
  let skipped = 0;
  for (const r of rows.slice(at + 1)) {
    const state = (r[col.state] ?? "").trim().toUpperCase();
    const net = money(r[col.net >= 0 ? col.net : col.retail]);
    const retail = col.retail >= 0 ? money(r[col.retail]) : null;
    if (!/^[A-Z]{2}$/.test(state) || !STATE_CENTER[state] || net == null) {
      skipped++;
      continue;
    }
    stations.push({ name: (r[col.name] ?? "").trim() || "Station", city: (r[col.city] ?? "").trim(), state, price: net, ...(retail != null && retail >= net ? { retail } : {}) });
  }
  return stations.length ? { stations: stations.slice(0, 5000), skipped } : { error: "No station in that file had a state and a price." };
}

/** The cheapest few stations in each state: all a fuel plan needs, and small enough to keep with the settings. */
export function keepCheapest(stations: FuelStation[], perState = 5): FuelStation[] {
  const by = new Map<string, FuelStation[]>();
  for (const s of stations) by.set(s.state, [...(by.get(s.state) ?? []), s]);
  return [...by.values()].flatMap((list) => list.sort((a, b) => a.price - b.price).slice(0, perState));
}

/** The cheapest station in each state the file covers. */
export function cheapestByState(stations: FuelStation[]): Record<string, FuelStation> {
  const out: Record<string, FuelStation> = {};
  for (const s of stations) if (!out[s.state] || s.price < out[s.state].price) out[s.state] = s;
  return out;
}

/**
 * The states a load runs through, in order, roughly: points along the straight line from the pickup to the delivery,
 * each named by the nearest freight city's state. Good enough to say where fuel is cheapest on the way; it isn't
 * directions.
 */
export function statesAlong(from: LatLng, to: LatLng, steps = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const at: LatLng = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
    const st = nearestCity(at, 160)?.state ?? nearestState(at);
    if (st && out[out.length - 1] !== st) out.push(st);
  }
  return out;
}

function nearestState(at: LatLng): string | undefined {
  let best: { st: string; d: number } | undefined;
  for (const [st, c] of Object.entries(STATE_CENTER)) {
    const d = distanceMiles(at, c);
    if (!best || d < best.d) best = { st, d };
  }
  return best?.st;
}

export const routeStates = (o: { city: string; state: string }, d: { city: string; state: string }) => {
  const a = cityCoords(o.city, o.state) ?? STATE_CENTER[o.state];
  const b = cityCoords(d.city, d.state) ?? STATE_CENTER[d.state];
  return a && b ? statesAlong(a, b) : null;
};
