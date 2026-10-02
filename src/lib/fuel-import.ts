import type { FuelTx, Load, TollTx, Truck } from "./types";

/**
 * Fuel card and toll statements in, matched to loads: the CSV a fuel card (WEX, Comdata, EFS, TCS, AtoB) or a toll
 * account (PrePass, BestPass, E-ZPass, state agencies) lets the owner download, or that the card company emails each
 * day. Columns are found by their names, since every provider calls them something slightly different. Each purchase
 * goes to the load that truck was on that day, so a load's real profit counts its fuel and tolls, and IFTA gets
 * gallons by state.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The first header that matches any of the names, as a column index. */
function col(headers: string[], ...names: string[]): number {
  const h = headers.map(norm);
  for (const n of names) {
    const i = h.findIndex((x) => x === n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = h.findIndex((x) => x.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

const money = (v: string | undefined) => {
  if (!v) return 0;
  const neg = /^\(.*\)$/.test(v.trim()) || v.trim().startsWith("-");
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};

/** Dates as statements write them: 2026-09-14, 09/14/2026, 9/14/26, 14-Sep-2026, with or without a time. */
export function toDay(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

const STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC ON QC MB SK AB BC".split(" "));
const stateOf = (v: string | undefined) => {
  const s = (v ?? "").trim().toUpperCase();
  return STATES.has(s) ? s : (s.match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/)?.[1] ?? "");
};

/** The truck a statement line belongs to: its unit number, or the last digits of a card or plate the owner tied to it. */
function truckFor(unit: string, trucks: Truck[]): Truck | undefined {
  const u = norm(unit);
  if (!u) return undefined;
  return (
    trucks.find((t) => norm(t.unitNumber) === u) ??
    trucks.find((t) => u.endsWith(norm(t.unitNumber).replace(/^t/, "")) && norm(t.unitNumber).replace(/^t/, "").length >= 3) ??
    trucks.find((t) => norm(t.unitNumber).replace(/^t/, "") === u.replace(/^(unit|truck|t)/, ""))
  );
}

export interface ImportResult<T> {
  rows: T[];
  /** Lines that couldn't be read (no date or no amount), with why. */
  skipped: { line: number; why: string }[];
}

const idOf = (prefix: string, parts: (string | number)[]) => {
  let h = 0;
  for (const ch of parts.join("|")) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `${prefix}_${(h >>> 0).toString(36)}`;
};

export function readFuelCsv(text: string, carrierId: string, trucks: Truck[], now = new Date().toISOString()): ImportResult<FuelTx> {
  const [headers = [], ...lines] = parseCsv(text);
  const c = {
    date: col(headers, "transactiondate", "trandate", "date", "purchasedate"),
    unit: col(headers, "unit", "unitnumber", "truck", "vehicle", "drivername", "cardnumber", "card"),
    merchant: col(headers, "merchant", "truckstop", "location", "site", "vendor", "stopname"),
    city: col(headers, "city", "locationcity"),
    state: col(headers, "state", "st", "locationstate", "jurisdiction"),
    gallons: col(headers, "gallons", "qty", "quantity", "units", "volume"),
    amount: col(headers, "totalamount", "amount", "total", "netamount", "cost", "transactionamount"),
    product: col(headers, "product", "item", "fueltype", "description"),
  };
  const out: FuelTx[] = [];
  const skipped: ImportResult<FuelTx>["skipped"] = [];
  lines.forEach((r, n) => {
    const date = toDay(r[c.date]);
    const amount = money(r[c.amount]);
    if (!date) return skipped.push({ line: n + 2, why: "no date" });
    if (!amount) return skipped.push({ line: n + 2, why: "no amount" });
    const product = (r[c.product] ?? "").toLowerCase();
    const unit = r[c.unit] ?? "";
    const city = r[c.city] ?? "";
    const state = stateOf(r[c.state]) || stateOf(r[c.merchant]);
    const gallons = money(r[c.gallons]);
    out.push({
      id: idOf("fuel", [date, unit, amount, gallons, r[c.merchant] ?? "", n]),
      carrierId,
      date,
      truckId: truckFor(unit, trucks)?.id ?? null,
      unit,
      merchant: r[c.merchant] ?? "",
      city,
      state,
      gallons,
      amount,
      product: /def/.test(product) ? "def" : /reefer|rfr/.test(product) ? "reefer" : !product || /diesel|ulsd|dsl|fuel/.test(product) ? "diesel" : "other",
      loadId: null,
      importedAt: now,
    });
  });
  return { rows: out, skipped };
}

export function readTollCsv(text: string, carrierId: string, trucks: Truck[], now = new Date().toISOString()): ImportResult<TollTx> {
  const [headers = [], ...lines] = parseCsv(text);
  const c = {
    date: col(headers, "transactiondate", "exitdate", "date", "postingdate", "entrydate"),
    unit: col(headers, "unit", "unitnumber", "truck", "vehicle", "plate", "licenseplate", "transponder", "tag", "device"),
    agency: col(headers, "agency", "tollagency", "authority", "facility", "road"),
    plaza: col(headers, "plaza", "exitplaza", "location", "lane", "exit"),
    state: col(headers, "state", "st"),
    amount: col(headers, "amount", "tollamount", "toll", "charge", "total"),
  };
  const out: TollTx[] = [];
  const skipped: ImportResult<TollTx>["skipped"] = [];
  lines.forEach((r, n) => {
    const date = toDay(r[c.date]);
    const amount = money(r[c.amount]);
    if (!date) return skipped.push({ line: n + 2, why: "no date" });
    if (!amount) return skipped.push({ line: n + 2, why: "no amount" });
    const unit = r[c.unit] ?? "";
    out.push({
      id: idOf("toll", [date, unit, amount, r[c.plaza] ?? "", n]),
      carrierId,
      date,
      truckId: truckFor(unit, trucks)?.id ?? null,
      unit,
      agency: r[c.agency] ?? "",
      plaza: r[c.plaza] ?? "",
      state: stateOf(r[c.state]) || stateOf(r[c.agency]),
      amount,
      loadId: null,
      importedAt: now,
    });
  });
  return { rows: out, skipped };
}

/** The days a load had its truck: from the day before pickup (fueling up for it) to the day it delivered. */
function loadDays(l: Load): [string, string] | null {
  const start = l.tripChecklist?.arrivedPickupAt ?? l.pickupAt ?? l.createdAt;
  const end = l.tripChecklist?.unloadedAt ?? l.deliveryAt ?? (l.stage === "delivered" ? l.updatedAt : new Date().toISOString());
  if (!start || !end) return null;
  const s = new Date(Date.parse(start) - 86400_000).toISOString().slice(0, 10);
  return [s, end.slice(0, 10)];
}

/** Puts each transaction on the load its truck was running that day. Ones with no truck or no load stay unmatched. */
export function matchToLoads<T extends { date: string; truckId: string | null; loadId: string | null }>(txs: T[], loads: Load[]): T[] {
  const byTruck = new Map<string, { id: string; days: [string, string] }[]>();
  for (const l of loads) {
    if (!l.truckId || ["sourced", "scoring", "offered", "negotiating", "declined", "cancelled"].includes(l.stage)) continue;
    const days = loadDays(l);
    if (!days) continue;
    byTruck.set(l.truckId, [...(byTruck.get(l.truckId) ?? []), { id: l.id, days }]);
  }
  return txs.map((t) => {
    if (t.loadId || !t.truckId) return t;
    // The latest-starting load that covers the day: a day with a delivery and the next pickup goes to the new load.
    const hit = (byTruck.get(t.truckId) ?? []).filter((x) => x.days[0] <= t.date && t.date <= x.days[1]).sort((a, b) => b.days[0].localeCompare(a.days[0]))[0];
    return hit ? { ...t, loadId: hit.id } : t;
  });
}

/** New ones only: the same statement imported twice, or overlapping statements, don't count anything twice. */
export function onlyNew<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const have = new Set(existing.map((x) => x.id));
  return incoming.filter((x) => !have.has(x.id));
}

export interface LoadCosts {
  fuel: number;
  gallons: number;
  tolls: number;
}

export function costsByLoad(fuel: FuelTx[], tolls: TollTx[]): Map<string, LoadCosts> {
  const out = new Map<string, LoadCosts>();
  const get = (id: string) => out.get(id) ?? out.set(id, { fuel: 0, gallons: 0, tolls: 0 }).get(id)!;
  for (const f of fuel) if (f.loadId) {
    const c = get(f.loadId);
    c.fuel += f.amount;
    if (f.product === "diesel") c.gallons += f.gallons;
  }
  for (const t of tolls) if (t.loadId) get(t.loadId).tolls += t.amount;
  return out;
}

/** Diesel gallons bought in each state this quarter: half of the IFTA return (the other half is miles by state). */
export function gallonsByState(fuel: FuelTx[], from: string, to: string): { state: string; gallons: number; amount: number }[] {
  const by = new Map<string, { gallons: number; amount: number }>();
  for (const f of fuel) {
    if (f.product !== "diesel" || f.date < from || f.date > to || !f.state) continue;
    const s = by.get(f.state) ?? { gallons: 0, amount: 0 };
    s.gallons += f.gallons;
    s.amount += f.amount;
    by.set(f.state, s);
  }
  return [...by].map(([state, v]) => ({ state, gallons: Math.round(v.gallons * 10) / 10, amount: Math.round(v.amount * 100) / 100 })).sort((a, b) => b.gallons - a.gallons);
}
