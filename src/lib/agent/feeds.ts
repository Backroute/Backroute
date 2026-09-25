import "server-only";
import type { OfferReading } from "./broker-mail";
import { offersFromEmail } from "./booking";
import type { CarrierContext } from "./db";
import type { FeedConfig } from "./integrations";

/**
 * Load feeds: any source that can publish loads as JSON or CSV at a web address (a broker's or shipper's load list,
 * a TMS export, or a load board once the carrier has API access). The AI reads it every round, and each load goes
 * through the same matching, pricing and booking as loads that arrive by email.
 *
 * One load per row (JSON: an array, or { "loads": [...] }; CSV: a header row). Fields:
 *   loadNumber, originCity, originState, destinationCity, destinationState, pickupLocal, deliveryLocal
 *   (YYYY-MM-DDTHH:mm at the stop), pickup, delivery (free text), equipment, rate, miles, weight,
 *   brokerName, brokerEmail, brokerPhone, brokerMc
 * A row needs a broker email or phone, or there'd be no one to book it with.
 *
 * DAT, Truckstop and 123Loadboard give API access only under a business agreement; with that, their search results
 * map onto these same fields.
 */

export interface FeedRow extends OfferReading {
  brokerName: string | null;
  brokerEmail: string | null;
  brokerPhone: string | null;
  brokerMc: string | null;
}

const str = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

export function toRow(r: Record<string, unknown>): FeedRow | null {
  const row: FeedRow = {
    loadNumber: str(r.loadNumber ?? r.load_number ?? r.reference),
    originCity: str(r.originCity ?? r.origin_city),
    originState: str(r.originState ?? r.origin_state)?.toUpperCase() ?? null,
    destinationCity: str(r.destinationCity ?? r.destination_city),
    destinationState: str(r.destinationState ?? r.destination_state)?.toUpperCase() ?? null,
    pickup: str(r.pickup),
    delivery: str(r.delivery),
    pickupLocal: str(r.pickupLocal ?? r.pickup_local),
    deliveryLocal: str(r.deliveryLocal ?? r.delivery_local),
    equipment: str(r.equipment),
    rate: num(r.rate),
    miles: num(r.miles),
    weight: num(r.weight),
    notes: str(r.notes),
    brokerName: str(r.brokerName ?? r.broker_name ?? r.broker),
    brokerEmail: str(r.brokerEmail ?? r.broker_email)?.toLowerCase() ?? null,
    brokerPhone: str(r.brokerPhone ?? r.broker_phone),
    brokerMc: str(r.brokerMc ?? r.broker_mc),
  };
  if (!row.originCity || !row.originState || !row.destinationCity || !row.destinationState) return null;
  if (!row.brokerEmail && !row.brokerPhone) return null;
  return row;
}

/** A small CSV reader: a header row, commas, and double-quoted fields that may hold commas or quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

export class FeedError extends Error {}

/** Reads the feed. Throws FeedError with a plain reason when it can't. */
export async function readFeed(cfg: FeedConfig): Promise<FeedRow[]> {
  let res: Response;
  try {
    res = await fetch(cfg.url, { headers: cfg.headerName && cfg.headerValue ? { [cfg.headerName]: cfg.headerValue } : {}, signal: AbortSignal.timeout(15000), cache: "no-store" });
  } catch {
    throw new FeedError("Couldn't reach the feed.");
  }
  if (!res.ok) throw new FeedError(`The feed answered ${res.status}.`);
  const text = await res.text();
  let raw: Record<string, unknown>[];
  if (cfg.format === "csv") raw = parseCsv(text);
  else {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new FeedError("The feed isn't JSON.");
    }
    raw = Array.isArray(body) ? body : ((body as { loads?: Record<string, unknown>[] })?.loads ?? []);
  }
  return raw.slice(0, 500).map(toRow).filter((r): r is FeedRow => r !== null);
}

/** Puts a feed's loads on the board (and, within the rules, asks to book the best), grouped by broker. */
export async function pullFeed(ctx: CarrierContext, rows: FeedRow[], feedName: string): Promise<number> {
  const byBroker = new Map<string, FeedRow[]>();
  for (const r of rows) {
    const k = r.brokerEmail ?? `phone:${r.brokerPhone}`;
    byBroker.set(k, [...(byBroker.get(k) ?? []), r]);
  }
  let added = 0;
  for (const group of byBroker.values()) {
    const first = group[0];
    const { added: a } = await offersFromEmail(
      ctx,
      group,
      { from: first.brokerEmail ?? "", fromName: first.brokerName ?? first.brokerEmail ?? "Broker", subject: `Loads from ${feedName}`, feed: feedName },
      { company: first.brokerName, mc: first.brokerMc, phone: first.brokerPhone },
    );
    added += a.length;
  }
  return added;
}
