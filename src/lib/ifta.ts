import { parseCsv } from "./csv";
import type { FuelTx, Load, Truck } from "./types";

/**
 * IFTA, the way a return is actually figured: miles run in each state (from the ELD), fuel bought in each state (from
 * the fuel card), and each state's diesel tax rate for the quarter (from IFTA, Inc.'s published rate matrix, which the
 * owner uploads; Backroute never makes a rate up).
 *
 *   fleet MPG = all miles ÷ all gallons bought
 *   taxable gallons in a state = miles there ÷ fleet MPG
 *   net tax for a state = (taxable gallons − gallons bought there) × that state's rate
 *
 * A positive net is owed to that state; a negative one is a credit. Surcharges some states add on top (KY, IN, VA's
 * surcharge lines in the matrix) are left for the return itself: the rows here are the base diesel rate.
 */

/** "2026-Q4" for a date. */
export function quarterOf(d: Date | string | number): string {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-Q${Math.floor(x.getUTCMonth() / 3) + 1}`;
}

/** The first and last day of a quarter, yyyy-mm-dd. */
export function quarterRange(q: string): { from: string; to: string } {
  const [y, n] = [Number(q.slice(0, 4)), Number(q.slice(-1))];
  const from = new Date(Date.UTC(y, (n - 1) * 3, 1));
  const to = new Date(Date.UTC(y, n * 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** What a truck keeps from one ELD reading to the next to count its miles by state. */
export interface IftaTrack {
  odometer?: number;
  lat: number;
  lon: number;
  state?: string;
  at: string;
}

/** Miles a truck ran in each state, by quarter ("2026-Q4" → { TX: 1820, OK: 410 }). */
export type StateMilesByQuarter = Record<string, Record<string, number>>;

const R_MILES = 3958.8;
function crowMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(h));
}

/** Roads run longer than a straight line; used only when the ELD gives no odometer. */
const ROAD_FACTOR = 1.17;
/** A jump bigger than this between two readings is a gap in the data (a swapped ECU, a long outage), not driving. */
const MAX_STEP_MILES = 900;

/**
 * Adds the miles between the last reading and this one to the right state. The odometer difference when the ELD sends
 * one (what an IFTA audit uses), otherwise the distance between the two spots. When the truck crossed a line between
 * readings the miles are split between the two states; readings come every few minutes, so that's a few miles at most.
 */
export function addReading(
  quarters: StateMilesByQuarter | undefined,
  last: IftaTrack | undefined,
  now: IftaTrack,
): { quarters: StateMilesByQuarter; track: IftaTrack; added: number } {
  const out: StateMilesByQuarter = { ...(quarters ?? {}) };
  const track: IftaTrack = { ...now, state: now.state ?? last?.state };
  if (!last || Date.parse(now.at) <= Date.parse(last.at)) return { quarters: out, track, added: 0 };
  let miles =
    now.odometer != null && last.odometer != null && now.odometer >= last.odometer ? now.odometer - last.odometer : crowMiles(last, now) * ROAD_FACTOR;
  if (!(miles > 0.05) || miles > MAX_STEP_MILES) miles = 0;
  const to = track.state;
  const from = last.state ?? to;
  if (!miles || !to || !from) return { quarters: out, track, added: 0 };
  const q = quarterOf(now.at);
  const row = { ...(out[q] ?? {}) };
  if (from === to) row[to] = (row[to] ?? 0) + miles;
  else {
    row[from] = (row[from] ?? 0) + miles / 2;
    row[to] = (row[to] ?? 0) + miles / 2;
  }
  out[q] = Object.fromEntries(Object.entries(row).map(([s, m]) => [s, Math.round(m * 10) / 10]));
  // Four quarters is all a return or an audit question needs here; older ones go.
  const keep = Object.keys(out).sort().slice(-4);
  for (const k of Object.keys(out)) if (!keep.includes(k)) delete out[k];
  return { quarters: out, track, added: miles };
}

/** Every truck's miles by state for a quarter, added up. */
export function fleetStateMiles(trucks: Pick<Truck, "stateMiles">[], quarter: string): Record<string, number> {
  const total: Record<string, number> = {};
  for (const t of trucks) for (const [s, m] of Object.entries(t.stateMiles?.[quarter] ?? {})) total[s] = (total[s] ?? 0) + m;
  return total;
}

/** A quarter's diesel rates per gallon by jurisdiction, from IFTA, Inc.'s rate matrix. */
export interface IftaRates {
  quarter: string;
  rates: Record<string, number>;
  importedAt: string;
  fileName: string;
}

const JURISDICTIONS: Record<string, string> = {
  alabama: "AL", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL",
  georgia: "GA", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB", newfoundland: "NL",
  "nova scotia": "NS", ontario: "ON", "prince edward island": "PE", quebec: "QC", saskatchewan: "SK",
};
const CODES = new Set(Object.values(JURISDICTIONS));

function jurisdiction(cell: string): string | null {
  const s = cell.trim();
  const up = s.toUpperCase();
  if (CODES.has(up)) return up;
  const lower = s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (JURISDICTIONS[lower]) return JURISDICTIONS[lower];
  const hit = Object.keys(JURISDICTIONS).find((name) => lower.startsWith(name));
  return hit ? JURISDICTIONS[hit] : null;
}

/**
 * Reads the rate matrix as IFTA, Inc. offers it for download (or any sheet with a jurisdiction column and a diesel
 * rate column in US dollars per gallon). The diesel column is the one whose header says diesel (or special diesel);
 * when there are US and Canadian columns, the US one. Rows it can't read are skipped and counted.
 */
export function parseIftaMatrix(text: string): { rates: Record<string, number>; skipped: number } | { error: string } {
  const rows = parseCsv(text, { separators: ",\t;", trim: true }).filter((r) => r.some((c) => c));
  if (rows.length < 2) return { error: "The file has no rows." };
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9$]/g, " ").replace(/\s+/g, " ").trim();
  // The header row is the first one that names a jurisdiction column and a diesel column.
  const at = rows.findIndex((r) => r.some((c) => /jurisdiction|state|province/.test(norm(c))) && r.some((c) => /diesel/.test(norm(c))));
  if (at < 0) return { error: "Couldn't find the Jurisdiction and Diesel columns. Upload the rate matrix file from iftach.org." };
  const head = rows[at].map(norm);
  const jCol = head.findIndex((h) => /jurisdiction|state|province/.test(h));
  const diesel = head.map((h, i) => ({ h, i })).filter(({ h }) => /diesel/.test(h) && !/biodiesel|b20|b100/.test(h));
  const dCol = (diesel.find(({ h }) => /u ?s|us\$|\$ ?us|united states/.test(h)) ?? diesel[0]).i;
  const rates: Record<string, number> = {};
  let skipped = 0;
  for (const r of rows.slice(at + 1)) {
    const j = jurisdiction(r[jCol] ?? "");
    const v = Number((r[dCol] ?? "").replace(/[^0-9.]/g, ""));
    if (!j || !Number.isFinite(v) || v <= 0 || v > 5) {
      if ((r[jCol] ?? "").trim()) skipped++;
      continue;
    }
    if (rates[j] === undefined) rates[j] = v;
  }
  if (Object.keys(rates).length < 5) return { error: "Found fewer than 5 rates. Is this the IFTA rate matrix?" };
  return { rates, skipped };
}

export interface IftaLine {
  state: string;
  miles: number;
  taxableGallons: number;
  paidGallons: number;
  rate: number | null;
  /** Tax owed (positive) or credit (negative); null when the state's rate isn't in the uploaded matrix. */
  net: number | null;
}

/** The return, state by state, from miles, gallons bought and the quarter's rates. */
export function iftaReturn(miles: Record<string, number>, gallons: Record<string, number>, rates: Record<string, number> | undefined) {
  const totalMiles = Object.values(miles).reduce((a, b) => a + b, 0);
  const totalGallons = Object.values(gallons).reduce((a, b) => a + b, 0);
  const mpg = totalGallons > 0 ? totalMiles / totalGallons : null;
  const states = [...new Set([...Object.keys(miles), ...Object.keys(gallons)])];
  const lines: IftaLine[] = states
    .map((state) => {
      const m = miles[state] ?? 0;
      const taxable = mpg ? m / mpg : 0;
      const paid = gallons[state] ?? 0;
      const rate = rates?.[state] ?? null;
      return {
        state,
        miles: Math.round(m),
        taxableGallons: Math.round(taxable * 10) / 10,
        paidGallons: Math.round(paid * 10) / 10,
        rate,
        net: rate === null || !mpg ? null : Math.round((taxable - paid) * rate * 100) / 100,
      };
    })
    .sort((a, b) => b.miles - a.miles);
  const missingRates = lines.filter((l) => l.rate === null).map((l) => l.state);
  const net = lines.reduce((s, l) => s + (l.net ?? 0), 0);
  return { lines, totalMiles: Math.round(totalMiles), totalGallons: Math.round(totalGallons), mpg: mpg ? Math.round(mpg * 100) / 100 : null, net: Math.round(net * 100) / 100, missingRates };
}

/** Gallons of diesel bought by state in a quarter, from the fuel card statement lines. */
export function gallonsInQuarter(fuel: FuelTx[], quarter: string): Record<string, number> {
  const { from, to } = quarterRange(quarter);
  const out: Record<string, number> = {};
  for (const f of fuel) if (f.product === "diesel" && f.state && f.date >= from && f.date <= to) out[f.state] = (out[f.state] ?? 0) + f.gallons;
  return out;
}

/**
 * The practice fleet only: no ELD, so miles are spread along each load's lane (half to the origin state, half to the
 * destination). Shown as a sample; a real account's numbers come from the ELD.
 */
export function sampleMilesByState(loads: Load[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const load of loads) {
    const half = load.lane.miles / 2;
    totals[load.lane.originState] = (totals[load.lane.originState] ?? 0) + half;
    totals[load.lane.destState] = (totals[load.lane.destState] ?? 0) + half;
  }
  return totals;
}
