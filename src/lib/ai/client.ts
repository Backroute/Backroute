import { create } from "zustand";
import { cloudEnabled, supabase } from "../cloud/client";

/**
 * The browser's side of the real AI. Every call can come back empty (no API key on the server, a demo visitor, a
 * network problem, or a slow answer), and the caller then uses the scripted reply, so the app never goes silent.
 */

/** Which chat threads are waiting on the AI, for the typing dots. Keyed "owner:<carrier>" or "driver:<id>". */
export const useAiTyping = create<{ threads: Record<string, boolean> }>(() => ({ threads: {} }));
export function setTyping(thread: string, on: boolean) {
  useAiTyping.setState((s) => ({ threads: { ...s.threads, [thread]: on } }));
}

// Once the server says the real AI isn't available to this visitor, stop asking for the rest of the visit.
let unavailable = false;
const NOT_FOR_THIS_VISIT = new Set(["ai_off", "demo_scripted", "demo_limit"]);

export async function authHeader(): Promise<Record<string, string>> {
  if (!cloudEnabled) return {};
  try {
    const { data } = await supabase().auth.getSession();
    return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
  } catch {
    return {};
  }
}

async function post<T>(path: string, body: BodyInit, json: boolean, timeoutMs: number): Promise<T | null> {
  if (unavailable) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { ...(json ? { "content-type": "application/json" } : {}), ...(await authHeader()) },
      body,
      signal: abort.signal,
    });
    const data = (await res.json().catch(() => null)) as (T & { unavailable?: string }) | null;
    if (data?.unavailable) {
      if (NOT_FOR_THIS_VISIT.has(data.unavailable)) unavailable = true;
      return null;
    }
    return res.ok ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatTurn {
  from: "user" | "ai";
  text: string;
}

/** The AI's answer, or null when the scripted reply should be used instead. */
export async function askAi(body: { role: "owner" | "driver"; question: string; history: ChatTurn[]; snapshot: object }): Promise<string | null> {
  const data = await post<{ reply?: string }>("/api/ai/chat", JSON.stringify(body), true, 30_000);
  return typeof data?.reply === "string" ? data.reply : null;
}

/** What was agreed on the load, for the rate con reader to check the paper against. */
export interface AgreedTerms {
  broker: string;
  rate: number;
  origin: string;
  destination: string;
  pickup: string;
  delivery: string;
  equipment: string;
  detention: string;
  paymentTerms: string;
}

export interface RateConMismatch {
  item: string;
  agreed: string;
  onDoc: string;
  serious: boolean;
}

export interface RateConReading {
  isRateCon: boolean;
  broker: string | null;
  brokerMc: string | null;
  brokerEmail?: string | null;
  loadNumber: string | null;
  totalRate: number | null;
  originCity?: string | null;
  originState?: string | null;
  destinationCity?: string | null;
  destinationState?: string | null;
  miles?: number | null;
  pickup: string | null;
  delivery: string | null;
  pickupLocal?: string | null;
  deliveryLocal?: string | null;
  equipment: string | null;
  detention: string | null;
  paymentTerms: string | null;
  finesAndFees: string[];
  mismatches: RateConMismatch[];
  otherConcerns: string[];
  summary: string;
}

export type RateConResult = { ok: true; reading: RateConReading } | { ok: false; reason: "off" | "failed" };

/** Sends a rate con PDF to the real AI. Unlike chat there's no scripted stand-in: a PDF needs the real thing. */
export async function readRateCon(file: File, agreed: AgreedTerms | null): Promise<RateConResult> {
  const form = new FormData();
  form.set("file", file);
  if (agreed) form.set("agreed", JSON.stringify(agreed));
  const wasUnavailable = unavailable;
  unavailable = false; // A deliberate upload always asks, even after chat fell back.
  const data = await post<{ reading?: RateConReading; error?: string }>("/api/ai/rate-con", form, false, 120_000);
  if (data?.reading) return { ok: true, reading: data.reading };
  const off = unavailable;
  unavailable = wasUnavailable || off;
  return { ok: false, reason: off ? "off" : "failed" };
}
