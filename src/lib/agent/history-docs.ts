import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { readRateConPdf } from "../ai/rate-con-reader";
import { aiConfigured } from "../ai/server";
import type { InboundEmail } from "../channels/email";
import { rowFor, type Item } from "../cloud/rows";
import { estimateMiles, guessEquipment, makeBroker, makeLoad } from "../fleet";
import { pushToOffice } from "../push";
import type { Broker, Load, RateConPdfReading, Truck } from "../types";
import { addActivity, admin, loadContext, save, type CarrierContext } from "./db";
import { event } from "./dispatcher";
import { newBatchId, recordBatch } from "./import-batches";

/**
 * The carrier's history from the paperwork it already has: old rate confirmations, uploaded in Settings (a batch of
 * PDFs or photos) or forwarded from their email to their history address. Each is read by the AI: the broker (name,
 * email, MC), the lane, what it paid, the terms and the shipper and receiver. They become finished loads in the
 * history (for pricing, never invoiced or texted) and brokers the AI already knows, so it prices like a dispatcher
 * who's worked the lanes for a year. The history address only takes mail for a week after the owner opens it.
 */

export interface DocFile {
  name: string;
  bytes: Buffer;
  contentType: string;
}

interface DocsResult {
  /** The import these went in with, to take it back out (lib/agent/import-batches). */
  batch?: string;
  read: number;
  loads: number;
  brokers: number;
  skipped: { file: string; why: string }[];
}

const YEAR = 365 * 86400_000;
const MAX_FILES = 40;
const squeeze = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Net 30", "30 days", "Quick pay 2 days": the days to pay it says. */
const termsDays = (terms: string | null | undefined) => Number(terms?.match(/(\d{1,3})\s*(?:days?|$)/i)?.[1] ?? terms?.match(/net\s*(\d{1,3})/i)?.[1]) || null;

function whenOf(r: RateConPdfReading | Omit<RateConPdfReading, "fileName" | "readAt">): Date | null {
  const s = r.pickupLocal ?? r.deliveryLocal ?? r.pickup ?? r.delivery ?? "";
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12));
  const us = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) return new Date(Date.UTC(us[3].length === 2 ? 2000 + +us[3] : +us[3], +us[1] - 1, +us[2], 12));
  return null;
}

async function inBatches<T, R>(items: T[], size: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  return out;
}

const fingerprint = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 32);

export async function importRateCons(ctx: CarrierContext, files: DocFile[], opts: { now?: number; batch?: string; via?: "upload" | "email" } = {}): Promise<DocsResult> {
  const now = opts.now ?? Date.now();
  const batchId = opts.batch ?? newBatchId();
  const skipped: DocsResult["skipped"] = [];
  if (!aiConfigured()) return { read: 0, loads: 0, brokers: 0, skipped: files.map((f) => ({ file: f.name, why: "the AI isn't switched on" })) };
  // The same file twice (sent again, or in two emails) is read once: no second load, and no second AI read.
  const known = new Set(ctx.loads.map((l) => l.importHash).filter(Boolean));
  const fresh: (DocFile & { hash: string })[] = [];
  for (const f of files) {
    const hash = fingerprint(f.bytes);
    if (known.has(hash)) skipped.push({ file: f.name, why: "already imported" });
    else {
      known.add(hash);
      fresh.push({ ...f, hash });
    }
  }
  const batch = fresh.slice(0, MAX_FILES);
  for (const f of fresh.slice(MAX_FILES)) skipped.push({ file: f.name, why: `only ${MAX_FILES} at a time; send the rest after` });

  const readings = await inBatches(batch, 3, async (f) => {
    try {
      return { f, r: await readRateConPdf(f.bytes, null, f.contentType) };
    } catch {
      return { f, r: null };
    }
  });

  const newBrokers: Broker[] = [];
  const updatedBrokers = new Map<string, Broker>();
  const loads: Load[] = [];
  const seen = new Set(ctx.loads.map((l) => `${l.brokerId}|${l.referenceNumber.toLowerCase()}`));
  const truck = { id: "", mpg: 6.5 } as Truck;
  const findBroker = (name: string, email: string | null, mc: string | null): Broker | undefined =>
    [...ctx.brokers, ...newBrokers].find(
      (b) => (!!email && b.email?.toLowerCase() === email.toLowerCase()) || (!!mc && b.mc === mc) || (!!name && squeeze(b.company) === squeeze(name)),
    );

  for (const { f, r } of readings) {
    if (!r) {
      skipped.push({ file: f.name, why: "couldn't be read" });
      continue;
    }
    if (!r.isRateCon) {
      skipped.push({ file: f.name, why: "not a rate confirmation" });
      continue;
    }
    if (!r.originCity || !r.originState || !r.destinationCity || !r.destinationState || !r.totalRate) {
      skipped.push({ file: f.name, why: "no lane or rate on it" });
      continue;
    }
    const when = whenOf(r) ?? new Date(now);
    if (when.getTime() < now - YEAR) {
      skipped.push({ file: f.name, why: "older than a year" });
      continue;
    }
    const mc = r.brokerMc?.replace(/\D/g, "") || null;
    const name = r.broker?.trim() || r.brokerEmail?.split("@")[1]?.split(".")[0]?.toUpperCase() || "";
    if (!name) {
      skipped.push({ file: f.name, why: "no broker named" });
      continue;
    }
    let broker = findBroker(name, r.brokerEmail ?? null, mc);
    if (!broker) {
      broker = { ...makeBroker(name, r.brokerEmail ?? null), ...(mc ? { mc } : {}) };
      const days = termsDays(r.paymentTerms);
      if (days) broker = { ...broker, avgDaysToPay: days };
      newBrokers.push(broker);
    } else if ((r.brokerEmail && !broker.email) || (mc && !broker.mc)) {
      broker = { ...broker, email: broker.email || r.brokerEmail || "", mc: broker.mc || mc || undefined };
      updatedBrokers.set(broker.id, broker);
    }
    const ref = r.loadNumber?.trim() || `RC-${squeeze(f.name).slice(0, 12)}`;
    if (seen.has(`${broker.id}|${ref.toLowerCase()}`)) {
      skipped.push({ file: f.name, why: `${ref} is already in Backroute` });
      continue;
    }
    seen.add(`${broker.id}|${ref.toLowerCase()}`);
    const from = { city: r.originCity, state: r.originState.toUpperCase().slice(0, 2) };
    const to = { city: r.destinationCity, state: r.destinationState.toUpperCase().slice(0, 2) };
    const miles = r.miles || estimateMiles(from, to);
    if (!miles) {
      skipped.push({ file: f.name, why: "unknown miles between those cities" });
      continue;
    }
    const at = when.toISOString();
    const base = makeLoad({ truckId: "", brokerId: broker.id, referenceNumber: ref, originCity: from.city, originState: from.state, destinationCity: to.city, destinationState: to.state, miles: Math.round(miles), pickupWindow: at.slice(0, 10), deliveryWindow: at.slice(0, 10), rate: Math.round(r.totalRate), equipment: guessEquipment(r.equipment ?? "") ?? "Dry Van" }, broker, truck, "booked");
    // The reading stays on it: the shipper and receiver names are how docks are recognized next time.
    const reading: RateConPdfReading = { ...r, mismatches: [], fileName: f.name, readAt: new Date(now).toISOString() };
    loads.push({ ...base, truckId: null, stage: "delivered", source: "Imported rate con", imported: true, importBatch: batchId, importHash: f.hash, isChained: false, progressPct: 100, createdAt: at, updatedAt: at, rateConReading: reading, ...(r.brokerEmail ? { brokerContactEmail: r.brokerEmail } : {}) });
  }

  for (const b of [...newBrokers, ...updatedBrokers.values()]) await save("records", ctx.carrier.id, b as unknown as Item, "broker");
  for (let n = 0; n < loads.length; n += 200) {
    const chunk = loads.slice(n, n + 200).map((l) => rowFor("loads", undefined, ctx.carrier.id, l as unknown as Item, l.updatedAt));
    const { error } = await admin().from("loads").upsert(chunk, { onConflict: "carrier_id,id" });
    if (error) throw error;
  }
  ctx.brokers.push(...newBrokers);
  ctx.loads.push(...loads);
  await recordBatch(ctx.carrier.id, batchId, { via: opts.via ?? "upload", label: opts.via === "email" ? "Rate cons from your email" : "Uploaded rate cons", loads: loads.length, brokerIds: newBrokers.map((b) => b.id) });
  return { batch: loads.length || newBrokers.length ? batchId : undefined, read: readings.length, loads: loads.length, brokers: newBrokers.length, skipped };
}

// ─── The history address ─────────────────────────────────────────────────────

const INBOX = "history_inbox";
const WEEK = 7 * 86400_000;

/**
 * Opens the history address for a week, with a new random part each time: brokers know the carrier's address, so the
 * history one can't just be that address plus a word anyone could guess. Kept apart from the settings the app saves.
 */
export async function openHistoryInbox(carrierId: string, now = Date.now()): Promise<{ until: string; token: string }> {
  const until = new Date(now + WEEK).toISOString();
  const token = Array.from(randomBytes(10), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  await admin().from("agent_marks").delete().eq("carrier_id", carrierId).eq("load_id", INBOX).eq("kind", INBOX);
  const { error } = await admin().from("agent_marks").insert({ carrier_id: carrierId, load_id: INBOX, kind: INBOX, data: { until, token } });
  if (error) throw error;
  return { until, token };
}

/** The address's mailbox part: the carrier's key, then "-h" and the token. */
export const historyHash = (inboundKey: string, token: string) => `${inboundKey}-h${token}`;
export const parseHistoryHash = (hash: string) => hash.match(/^([a-z0-9]+)-h([a-z0-9]{10})$/);

async function historyInbox(carrierId: string): Promise<{ until: string; token: string } | null> {
  const { data } = await admin().from("agent_marks").select("data").eq("carrier_id", carrierId).eq("load_id", INBOX).eq("kind", INBOX).maybeSingle();
  const d = data?.data as { until?: string; token?: string } | null;
  return d?.until && d.token ? { until: d.until, token: d.token } : null;
}

/** PDFs (and big photos) inside an email forwarded as an attachment (.eml): a small reader for base64 MIME parts. */
function filesInEml(raw: string, depth = 0): DocFile[] {
  if (depth > 3) return [];
  const boundary = raw.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  if (!boundary) return [];
  const out: DocFile[] = [];
  for (const part of raw.split(`--${boundary}`)) {
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    const head = part.slice(0, split);
    const body = part.slice(split).trim();
    const type = head.match(/content-type:\s*([^;\r\n]+)/i)?.[1]?.trim().toLowerCase() ?? "";
    if (type.startsWith("multipart/")) {
      out.push(...filesInEml(part, depth + 1));
      continue;
    }
    if (type === "message/rfc822") {
      out.push(...filesInEml(body, depth + 1));
      continue;
    }
    const name = head.match(/(?:file)?name="?([^";\r\n]+)"?/i)?.[1] ?? "attachment";
    const isPdf = type === "application/pdf" || /\.pdf$/i.test(name);
    const isPhoto = /^image\/(jpeg|png|webp)$/.test(type);
    if ((!isPdf && !isPhoto) || !/content-transfer-encoding:\s*base64/i.test(head)) continue;
    const bytes = Buffer.from(body.replace(/--$/, "").replace(/\s+/g, ""), "base64");
    if (bytes.length > 10 * 1024 * 1024 || (isPhoto && bytes.length < 60 * 1024)) continue;
    out.push({ name, bytes, contentType: isPdf ? "application/pdf" : type });
  }
  return out;
}

/** An email to the history address: its rate cons (attached, or inside forwarded emails) go into the history. */
export async function historyFromEmail(carrierId: string, email: InboundEmail, token: string): Promise<DocsResult | null> {
  const inbox = await historyInbox(carrierId);
  const a = Buffer.from(inbox?.token ?? "");
  const b = Buffer.from(token);
  if (!inbox || Date.parse(inbox.until) < Date.now() || a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const ctx = await loadContext(carrierId);
  if (!ctx) return null;
  const files: DocFile[] = [];
  for (const a of email.Attachments ?? []) {
    const bytes = Buffer.from(a.Content, "base64");
    if (a.ContentType === "message/rfc822" || /\.eml$/i.test(a.Name)) files.push(...filesInEml(bytes.toString("latin1")));
    else if ((a.ContentType === "application/pdf" || /\.pdf$/i.test(a.Name)) && bytes.length <= 10 * 1024 * 1024) files.push({ name: a.Name, bytes, contentType: "application/pdf" });
    else if (/^image\/(jpeg|png|webp)$/.test(a.ContentType) && a.ContentLength >= 60 * 1024) files.push({ name: a.Name, bytes, contentType: a.ContentType });
  }
  if (!files.length) return { read: 0, loads: 0, brokers: 0, skipped: [] };
  const result = await importRateCons(ctx, files, { via: "email" });
  const line = `Read ${result.read} rate con${result.read === 1 ? "" : "s"} from your email: ${result.loads} past load${result.loads === 1 ? "" : "s"} and ${result.brokers} new broker${result.brokers === 1 ? "" : "s"} added to the history.`;
  await addActivity(ctx.carrier.id, event({ type: "tms_synced", message: "History from your email", detail: line, severity: "success" }));
  await pushToOffice(ctx.carrier.id, { title: "History added", body: line, url: "/carrier/settings", tag: "history" }).catch(() => 0);
  return result;
}
