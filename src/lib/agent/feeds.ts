import "server-only";
import { parseCsvRecords } from "../csv";
import type { OfferReading } from "./broker-mail";
import { offersFromEmail } from "./booking";
import type { CarrierContext } from "./db";
import type { FeedConfig } from "./integrations";
import { fetchOwnerUrl, UnsafeUrl } from "../owner-url";

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

/**
 * A partial (LTL-sized) load, from what a feed or board says: a full/partial flag ("P", "Partial", "LTL", true), the
 * pallets and the feet of trailer it takes, or words in the notes ("partial, 8 pallets", "12 ft"). Nothing when it's
 * a full load or it doesn't say.
 */
export function partialOf(f: { fullPartial?: unknown; pallets?: unknown; length?: unknown; notes?: unknown }): { partial?: boolean; pallets?: number | null; lengthFeet?: number | null; stackable?: boolean | null; palletHeightIn?: number | null } {
  const flag = f.fullPartial === true || /^(p|partial|ltl|ptl|volume)$/i.test(String(f.fullPartial ?? "").trim());
  const notes = String(f.notes ?? "");
  const said = /\b(partial|ltl|ptl|volume (load|shipment)|co-?load)\b/i.test(notes);
  if (!flag && !said) return {};
  const pallets = num(f.pallets) ?? (Number(notes.match(/\b(\d{1,2})\s*(pallets?|plts?|skids?)\b/i)?.[1]) || null);
  const feet = num(f.length) ?? (Number(notes.match(/\b(\d{1,2})\s*(ft|feet|')(?![a-z])/i)?.[1]) || null);
  // "Stackable" or "do not stack" in the notes, and a height like 48" or 48 in.
  const stackable = /\b(do not|don'?t|no|non[- ]?)\s*stack/i.test(notes) ? false : /\bstackable\b/i.test(notes) ? true : null;
  const height = Number(notes.match(/\b(\d{2,3})\s*(?:"|in\b|inch(?:es)?\b)\s*(?:tall|high)?/i)?.[1]) || null;
  return { partial: true, pallets: pallets && pallets > 0 && pallets <= 30 ? pallets : null, lengthFeet: feet && feet > 0 && feet < 53 ? feet : null, stackable, palletHeightIn: height && height >= 20 && height <= 120 ? height : null };
}

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
    ...partialOf({ fullPartial: r.fullPartial ?? r.full_partial ?? r.partial ?? r.loadSize ?? r.load_size, pallets: r.pallets, length: r.lengthFeet ?? r.length_feet ?? r.length, notes: r.notes }),
    brokerName: str(r.brokerName ?? r.broker_name ?? r.broker),
    brokerEmail: str(r.brokerEmail ?? r.broker_email)?.toLowerCase() ?? null,
    brokerPhone: str(r.brokerPhone ?? r.broker_phone),
    brokerMc: str(r.brokerMc ?? r.broker_mc),
  };
  if (!row.originCity || !row.originState || !row.destinationCity || !row.destinationState) return null;
  if (!row.brokerEmail && !row.brokerPhone) return null;
  return row;
}


export class FeedError extends Error {}

/** Reads the feed. Throws FeedError with a plain reason when it can't. */
export async function readFeed(cfg: FeedConfig): Promise<FeedRow[]> {
  let res: Response;
  try {
    res = await fetchOwnerUrl(cfg.url, { headers: cfg.headerName && cfg.headerValue ? { [cfg.headerName]: cfg.headerValue } : {}, signal: AbortSignal.timeout(15000), cache: "no-store" });
  } catch (e) {
    throw new FeedError(e instanceof UnsafeUrl ? e.message : "Couldn't reach the feed.");
  }
  if (!res.ok) throw new FeedError(`The feed answered ${res.status}.`);
  const text = await res.text();
  let raw: Record<string, unknown>[];
  if (cfg.format === "csv") raw = parseCsvRecords(text);
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
