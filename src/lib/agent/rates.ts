import "server-only";
import type { EquipmentType } from "../types";

/**
 * What a lane pays right now, from a rate data service: the number good dispatchers carry in their heads. The AI uses
 * it to open above a low post and to know when a post is under the market. The owner's lowest rate still rules.
 *
 * One service at a time, picked by which keys are set:
 * - DAT RateView (DAT_RATES_URL plus the DAT service account from the load board setup)
 * - Greenscreens.ai (GREENSCREENS_API_KEY)
 * - Any other (RATES_API_URL with {{originCity}} {{originState}} {{destinationCity}} {{destinationState}} {{equipment}},
 *   RATES_API_HEADER "Name: value", and RATES_RPM_PATH / RATES_HIGH_PATH for where the numbers are in the answer).
 *
 * TO CONFIRM WHEN ACCESS IS GRANTED: DAT and Greenscreens share their API documents with customers only. The request
 * and answer shapes below follow their published product descriptions and must be checked against their documents.
 * The addresses are all settings, and the stand-ins used for testing implement exactly these shapes.
 */

export interface MarketRate {
  /** Average all-in rate per mile. */
  rpm: number;
  /** The top of the usual range, when the service gives one. */
  high?: number;
  source: string;
}

const CODE: Record<EquipmentType, string> = { "Dry Van": "VAN", Reefer: "REEFER", Flatbed: "FLATBED", Container: "VAN" };
const cache = new Map<string, { at: number; rate: MarketRate | null }>();
const FRESH = 6 * 3600_000;

export const ratesConfigured = () => Boolean(process.env.GREENSCREENS_API_KEY || process.env.RATES_API_URL || (process.env.DAT_RATES_URL && process.env.DAT_SERVICE_EMAIL));

function at(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : typeof v === "string" && Number(v) > 0 ? Number(v) : undefined);

async function json(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`rates ${res.status}`);
  return res.json();
}

type Lane = { originCity: string; originState: string; destinationCity: string; destinationState: string; equipment: EquipmentType };

async function greenscreens(l: Lane): Promise<MarketRate | null> {
  const base = process.env.GREENSCREENS_API_BASE?.replace(/\/$/, "") ?? "https://api.greenscreens.ai";
  const body = await json(`${base}/v3/prediction/rates`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GREENSCREENS_API_KEY}` },
    body: JSON.stringify({ pickupDateTime: new Date().toISOString(), transportType: CODE[l.equipment], stops: [{ order: 0, city: l.originCity, state: l.originState, country: "US" }, { order: 1, city: l.destinationCity, state: l.destinationState, country: "US" }] }),
  });
  const rpm = num(at(body, "targetBuyRate"));
  return rpm ? { rpm, high: num(at(body, "highBuyRate")), source: "Greenscreens" } : null;
}

async function dat(l: Lane): Promise<MarketRate | null> {
  // The same two-step sign-in as DAT's load board API, then a lane rate lookup.
  const identity = process.env.DAT_IDENTITY_BASE?.replace(/\/$/, "") ?? "https://identity.api.dat.com";
  const org = (await json(`${identity}/access/v1/token/organization`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.DAT_SERVICE_EMAIL, password: process.env.DAT_SERVICE_PASSWORD }) })) as { accessToken?: string };
  if (!org.accessToken) return null;
  const body = await json(process.env.DAT_RATES_URL!, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${org.accessToken}` },
    body: JSON.stringify([{ origin: { city: l.originCity, stateOrProvince: l.originState }, destination: { city: l.destinationCity, stateOrProvince: l.destinationState }, equipment: CODE[l.equipment], includeMyRate: false, rateType: "SPOT", rateTimePeriod: { rateTimeframe: "7_DAYS" } }]),
  });
  const first = Array.isArray(at(body, "rateResponses")) ? (at(body, "rateResponses") as unknown[])[0] : undefined;
  const rpm = num(at(first, "response.rate.perMile.rateUsd"));
  return rpm ? { rpm, high: num(at(first, "response.rate.perMile.highUsd")), source: "DAT RateView" } : null;
}

async function custom(l: Lane): Promise<MarketRate | null> {
  const values: Record<string, string> = { ...l, equipment: CODE[l.equipment] };
  const url = process.env.RATES_API_URL!.replace(/\{\{(\w+)\}\}/g, (_, k: string) => encodeURIComponent(values[k] ?? ""));
  const [name, ...rest] = (process.env.RATES_API_HEADER ?? "").split(":");
  const body = await json(url, { headers: { accept: "application/json", ...(name && rest.length ? { [name.trim()]: rest.join(":").trim() } : {}) } });
  const rpm = num(at(body, process.env.RATES_RPM_PATH ?? "rpm"));
  return rpm ? { rpm, high: num(at(body, process.env.RATES_HIGH_PATH ?? "high")), source: process.env.RATES_API_NAME ?? "Rate service" } : null;
}

/** The market rate for a lane, or null when no service is set up or it has nothing. Never throws. */
export async function marketRate(l: Lane): Promise<MarketRate | null> {
  if (!ratesConfigured()) return null;
  const key = `${l.originCity}|${l.originState}|${l.destinationCity}|${l.destinationState}|${l.equipment}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH) return hit.rate;
  let rate: MarketRate | null = null;
  try {
    rate = process.env.GREENSCREENS_API_KEY ? await greenscreens(l) : process.env.RATES_API_URL ? await custom(l) : await dat(l);
  } catch (e) {
    console.error("[rates] lookup failed", e);
  }
  cache.set(key, { at: Date.now(), rate });
  return rate;
}
