import "server-only";
import { rowFor, type Item } from "../cloud/rows";
import { parseCsv } from "../csv";
import { estimateMiles, guessEquipment, makeBroker, makeLoad } from "../fleet";
import type { Broker, Load, Truck } from "../types";
import { admin, save, type CarrierContext } from "./db";
import { newBatchId, recordBatch } from "./import-batches";

/**
 * A carrier's history, from a spreadsheet (a TMS export, QuickBooks, their own sheet): the brokers they work with and
 * the loads they hauled, with what each paid. The AI prices from it from day one: what the carrier gets on a lane,
 * what each broker has paid and how they haggle (lib/agent/memory). Imported loads are finished history: no truck,
 * no paperwork, so nothing is invoiced, texted or chased for them.
 */

interface HistoryResult {
  /** The import these went in with, to take it back out (lib/agent/import-batches). */
  batch?: string;
  loads: number;
  brokers: number;
  skipped: { line: number; why: string }[];
  columns: Partial<Record<Field, string>>;
}

type Field = "date" | "broker" | "email" | "phone" | "mc" | "origin" | "originState" | "destination" | "destState" | "miles" | "rate" | "ref" | "equipment";

// Column names people use for each thing, lowercased with spaces and punctuation squeezed out.
const NAMES: Record<Field, string[]> = {
  date: ["date", "pickupdate", "shipdate", "loaddate", "deliverydate", "delivered", "deliverydt", "pudate", "pickup date"],
  broker: ["broker", "brokername", "customer", "customername", "company", "billto", "shipper broker"],
  email: ["brokeremail", "email", "contactemail", "customeremail"],
  phone: ["brokerphone", "phone", "contactphone", "customerphone"],
  mc: ["mc", "brokermc", "mcnumber", "mcno", "brokermcnumber"],
  origin: ["origin", "from", "pickup", "pickupcity", "origincity", "shippercity", "pucity", "fromcity"],
  originState: ["originstate", "pickupstate", "fromstate", "ost", "shipperstate", "pustate", "ostate"],
  destination: ["destination", "to", "delivery", "dest", "deliverycity", "destinationcity", "destcity", "consigneecity", "tocity", "receivercity"],
  destState: ["destinationstate", "deliverystate", "deststate", "tostate", "dst", "consigneestate", "receiverstate", "dstate"],
  miles: ["miles", "loadedmiles", "distance", "mileage", "tripmiles"],
  rate: ["rate", "linehaul", "total", "amount", "pay", "revenue", "gross", "totalrate", "loadpay", "invoiceamount"],
  ref: ["load", "loadnumber", "loadno", "reference", "ref", "refnumber", "pro", "order", "ordernumber"],
  equipment: ["equipment", "trailer", "trailertype", "type", "equipmenttype"],
};

const squeeze = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");


/** Which column holds what, from the header row. */
function mapColumns(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const names = header.map(squeeze);
  for (const field of Object.keys(NAMES) as Field[]) {
    const i = names.findIndex((n, idx) => NAMES[field].map(squeeze).includes(n) && !Object.values(out).includes(idx));
    if (i >= 0) out[field] = i;
  }
  return out;
}

const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** "2026-03-14", "3/14/2026", "3/14/26": a date, or null. */
function dateOf(s: string): Date | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2], 12));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Dallas, TX" or "Dallas TX" in one cell: the city and state. */
function place(city: string, state?: string): { city: string; state: string } | null {
  const c = city.trim();
  if (state?.trim()) return c ? { city: c, state: state.trim().toUpperCase().slice(0, 2) } : null;
  const m = c.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : null;
}

const MAX_ROWS = 5000;
const YEAR = 365 * 86400_000;

/** Reads the spreadsheet and, unless it's a dry run, saves the brokers and loads. */
export async function importHistory(ctx: CarrierContext, csv: string, opts: { dryRun?: boolean; now?: number } = {}): Promise<HistoryResult> {
  const now = opts.now ?? Date.now();
  const batch = newBatchId();
  const rows = parseCsv(csv);
  const header = rows.shift() ?? [];
  const col = mapColumns(header);
  const columns = Object.fromEntries(Object.entries(col).map(([f, i]) => [f, header[i as number]])) as HistoryResult["columns"];
  const skipped: HistoryResult["skipped"] = [];
  if (col.rate === undefined || col.origin === undefined || col.destination === undefined) {
    return { loads: 0, brokers: 0, skipped: [{ line: 1, why: "Couldn't find the rate, origin and destination columns. Name them like Rate, Origin, Destination." }], columns };
  }
  const cell = (r: string[], f: Field) => (col[f] === undefined ? "" : (r[col[f]!] ?? "").trim());
  const brokers = new Map<string, Broker>();
  const byKey = (name: string, email: string) => (email ? `e:${email.toLowerCase()}` : `n:${squeeze(name)}`);
  for (const b of ctx.brokers) {
    if (b.email) brokers.set(byKey("", b.email), b);
    brokers.set(byKey(b.company, ""), b);
  }
  const newBrokers: Broker[] = [];
  const loads: Load[] = [];
  const seen = new Set(ctx.loads.map((l) => `${l.brokerId}|${l.referenceNumber.toLowerCase()}`));
  const truck = { id: "", mpg: 6.5 } as Truck;

  rows.slice(0, MAX_ROWS).forEach((r, i) => {
    const line = i + 2;
    const from = place(cell(r, "origin"), cell(r, "originState"));
    const to = place(cell(r, "destination"), cell(r, "destState"));
    const rate = money(cell(r, "rate"));
    const when = dateOf(cell(r, "date")) ?? new Date(now);
    if (!from || !to) return skipped.push({ line, why: "no origin or destination city and state" });
    if (!rate) return skipped.push({ line, why: "no rate" });
    if (when.getTime() < now - YEAR) return skipped.push({ line, why: "older than a year" });
    const name = cell(r, "broker") || cell(r, "email").split("@")[1]?.split(".")[0]?.toUpperCase() || "";
    if (!name) return skipped.push({ line, why: "no broker" });
    const email = cell(r, "email");
    let broker = brokers.get(byKey(name, email)) ?? brokers.get(byKey(name, ""));
    if (!broker) {
      broker = { ...makeBroker(name, email || null), phone: cell(r, "phone"), mc: cell(r, "mc").replace(/\D/g, "") || undefined };
      brokers.set(byKey(name, email), broker);
      if (email) brokers.set(byKey(name, ""), broker);
      newBrokers.push(broker);
    }
    const ref = cell(r, "ref") || `HIST-${line}`;
    if (seen.has(`${broker.id}|${ref.toLowerCase()}`)) return skipped.push({ line, why: `${ref} is already in Backroute` });
    seen.add(`${broker.id}|${ref.toLowerCase()}`);
    const miles = Number(cell(r, "miles").replace(/[^\d.]/g, "")) || estimateMiles(from, to) || null;
    if (!miles) return skipped.push({ line, why: "unknown miles between those cities" });
    const at = when.toISOString();
    const base = makeLoad({ truckId: "", brokerId: broker.id, referenceNumber: ref, originCity: from.city, originState: from.state, destinationCity: to.city, destinationState: to.state, miles: Math.round(miles), pickupWindow: at.slice(0, 10), deliveryWindow: at.slice(0, 10), rate, equipment: guessEquipment(cell(r, "equipment")) ?? "Dry Van" }, broker, truck, "booked");
    loads.push({ ...base, truckId: null, stage: "delivered", source: "Imported history", imported: true, importBatch: batch, isChained: false, progressPct: 100, createdAt: at, updatedAt: at });
  });
  if (rows.length > MAX_ROWS) skipped.push({ line: MAX_ROWS + 2, why: `only the first ${MAX_ROWS} rows are read` });

  if (!opts.dryRun) {
    for (const b of newBrokers) await save("records", ctx.carrier.id, b as unknown as Item, "broker");
    // Each load keeps the date it ran as its last update, so a year of history never pushes this week's loads out
    // of what the AI reads first.
    for (let n = 0; n < loads.length; n += 200) {
      const chunk = loads.slice(n, n + 200).map((l) => rowFor("loads", undefined, ctx.carrier.id, l as unknown as Item, l.updatedAt));
      const { error } = await admin().from("loads").upsert(chunk, { onConflict: "carrier_id,id" });
      if (error) throw error;
    }
    await recordBatch(ctx.carrier.id, batch, { via: "spreadsheet", label: "Spreadsheet", loads: loads.length, brokerIds: newBrokers.map((b) => b.id) });
  }
  return { ...(opts.dryRun || !(loads.length || newBrokers.length) ? {} : { batch }), loads: loads.length, brokers: newBrokers.length, skipped, columns };
}
