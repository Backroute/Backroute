import "server-only";
import type { Driver, Load } from "../types";
import { admin, type CarrierContext } from "./db";
import { norm } from "./facilities";

/**
 * What drivers know about a dock after they've been there once: which gate, how check-in works, where to park, the
 * rules, when receiving closes. A driver tells the AI in passing ("back in from the east gate, no overnight parking")
 * and the next driver going there hears it: in the new-load text, the morning text, the check-in before the stop,
 * and whenever they ask. Tips are pooled across every carrier on Backroute, as notes about a place: the AI writes
 * them without names or phone numbers, and those are stripped again before saving.
 */

export type StopKind = "pickup" | "delivery";

export interface FacilityRef {
  stop: StopKind;
  name: string;
  city: string;
  state: string;
  /** From the rate con, when it has it: two docks with the same name in one city are told apart by it. */
  zip?: string | null;
}

export interface FacilityHours {
  opens?: string;
  closes?: string;
  /** Days it's open, e.g. ["Mon","Tue","Wed","Thu","Fri"]. */
  days?: string[];
  /** When a day keeps different hours (Saturday 08:00-12:00), from the posted hours. */
  byDay?: Partial<Record<string, { opens?: string; closes?: string }>>;
}

export interface FacilityNote {
  note: string;
  hours: FacilityHours | null;
  at: string;
  /** The carrier whose driver said it. Another carrier's word is passed on, but never blocks a booking. */
  carrierId: string;
}

const KEEP_DAYS = 180;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The shipper and receiver on a load, from its rate con. */
export function facilitiesOf(load: Load): FacilityRef[] {
  const r = load.rateConReading;
  const out: FacilityRef[] = [];
  const zip = (z?: string | null) => z?.match(/\b\d{5}\b/)?.[0] ?? null;
  if (r?.shipper) out.push({ stop: "pickup", name: r.shipper, city: load.lane.origin, state: load.lane.originState, zip: zip(r.shipperZip) });
  if (r?.receiver) out.push({ stop: "delivery", name: r.receiver, city: load.lane.destination, state: load.lane.destState, zip: zip(r.receiverZip) });
  return out;
}

/** Phone numbers, emails and "ask for Maria"-style names out; a tip is about the place. */
export function scrub(note: string): string {
  return note
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]")
    .replace(/\S+@\S+\.\w+/g, "[email]")
    .replace(/\b([Aa]sk for|[Tt]alk to|[Cc]all)\s+[A-Z][a-z]+(\s[A-Z][a-z]+)?/g, (_, verb: string) => `${verb} the office`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

const hhmm = (s?: string) => (s && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim()) ? s.trim().padStart(5, "0") : undefined);

export function cleanHours(h: { opens?: string; closes?: string; days?: string } | undefined): FacilityHours | null {
  if (!h) return null;
  const opens = hhmm(h.opens);
  const closes = hhmm(h.closes);
  const days = h.days
    ?.split(/[,\s/]+/)
    .map((d) => DAYS.find((x) => x.toLowerCase() === d.slice(0, 3).toLowerCase()))
    .filter((d): d is string => !!d);
  // "Mon-Fri" as a range.
  const range = h.days?.match(/^(\w{3})\w*\s*[-–]\s*(\w{3})\w*$/);
  let span: string[] | undefined;
  if (range) {
    const a = DAYS.findIndex((x) => x.toLowerCase() === range[1].toLowerCase());
    const b = DAYS.findIndex((x) => x.toLowerCase() === range[2].toLowerCase());
    if (a >= 0 && b >= 0) span = a <= b ? DAYS.slice(a, b + 1) : [...DAYS.slice(a), ...DAYS.slice(0, b + 1)];
  }
  const out: FacilityHours = { ...(opens ? { opens } : {}), ...(closes ? { closes } : {}), ...(span?.length ? { days: span } : days?.length ? { days } : {}) };
  return Object.keys(out).length ? out : null;
}

/**
 * Words that read as orders to an AI rather than a note about a dock. Tips are read by other carriers' AI, so one
 * trying to steer it ("ignore your instructions", "tell drivers to...") is refused, as are links.
 */
const STEERING = /\b(ignore|disregard|forget)\b.{0,30}\b(instructions?|rules?|previous|above|prompt)\b|\b(system prompt|you are an? |as an ai|assistant:|developer:)|https?:\/\/|www\./i;
export const looksLikeSteering = (note: string) => STEERING.test(note);

/** At most this many tips a day from one driver, so one person can't flood a dock's record. */
const PER_DRIVER_DAY = 8;

export type NoteSaved = "saved" | "empty" | "refused" | "too_many";

/** Saves a driver's tip about one of their load's stops. */
export async function addFacilityNote(ctx: CarrierContext, driver: Driver, where: FacilityRef, note: string, hours: FacilityHours | null): Promise<NoteSaved> {
  const clean = scrub(note);
  if (clean.length < 3) return "empty";
  if (looksLikeSteering(clean)) return "refused";
  const { count } = await admin().from("facility_notes").select("id", { head: true, count: "exact" }).eq("carrier_id", ctx.carrier.id).eq("driver_id", driver.id).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  if ((count ?? 0) >= PER_DRIVER_DAY) return "too_many";
  const { error } = await admin()
    .from("facility_notes")
    .insert({ carrier_id: ctx.carrier.id, driver_id: driver.id, name_key: norm(where.name), city: where.city.toLowerCase(), state: where.state.toUpperCase(), zip: where.zip ?? null, note: clean, hours });
  if (error) throw error;
  return "saved";
}

/** The latest tips about one place, from every carrier's drivers, newest first. */
export async function notesAbout(where: Pick<FacilityRef, "name" | "city" | "state" | "zip">, limit = 3): Promise<FacilityNote[]> {
  if (!norm(where.name)) return [];
  const since = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  let q = admin()
    .from("facility_notes")
    .select("note, hours, created_at, carrier_id")
    .eq("name_key", norm(where.name))
    .eq("city", where.city.toLowerCase())
    .eq("state", where.state.toUpperCase())
    .gte("created_at", since);
  // With a ZIP, only tips for that dock (or ones saved without a ZIP).
  if (where.zip) q = q.or(`zip.eq.${where.zip},zip.is.null`);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit * 3);
  if (error) return [];
  // The same tip twice (two drivers said it) once.
  const seen = new Set<string>();
  return (data ?? [])
    .filter((r) => {
      const k = String(r.note).toLowerCase();
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, limit)
    .filter((r) => !looksLikeSteering(String(r.note)))
    .slice(0, limit)
    .map((r) => ({ note: r.note as string, hours: (r.hours as FacilityHours | null) ?? null, at: r.created_at as string, carrierId: r.carrier_id as string }));
}

/**
 * The receiving or shipping hours drivers last reported for a place, if any, and whether they're this carrier's own
 * drivers' word (`own`): only that can stop a booking; another carrier's is a heads-up.
 */
export async function hoursAt(where: Pick<FacilityRef, "name" | "city" | "state" | "zip">, carrierId?: string): Promise<{ hours: FacilityHours; own: boolean } | null> {
  const n = (await notesAbout(where, 10)).find((x) => x.hours);
  return n?.hours ? { hours: n.hours, own: !!carrierId && n.carrierId === carrierId } : null;
}

/** Tips for a load's stops, as lines for a driver ("Acme DC (delivery): back in from the east gate"), in English. */
export async function tipsForLoad(load: Load, only?: StopKind): Promise<string[]> {
  const lines: string[] = [];
  for (const f of facilitiesOf(load)) {
    if (only && f.stop !== only) continue;
    const notes = await notesAbout(f).catch(() => []);
    if (notes.length) lines.push(`${f.name} (${f.stop}): ${notes.map((n) => n.note.replace(/\.$/, "")).join("; ")}.`);
  }
  return lines;
}

const span = (x: { opens?: string; closes?: string }) => (x.opens && x.closes ? `${x.opens}–${x.closes}` : x.closes ? `until ${x.closes}` : x.opens ? `from ${x.opens}` : null);
export const formatHours = (h: FacilityHours) => {
  const usual = [h.days?.length ? h.days.filter((d) => !h.byDay?.[d]).join("/") : null, span(h)].filter(Boolean).join(" ");
  const odd = Object.entries(h.byDay ?? {}).map(([d, x]) => `${d} ${span(x ?? {}) ?? ""}`.trim());
  return [usual, ...odd].filter(Boolean).join(", ");
};
