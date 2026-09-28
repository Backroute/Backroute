import "server-only";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { canText, textTo } from "../channels/out";
import type { Driver, Load, ReeferTerms } from "../types";
import { claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { passToOwner, uid } from "./dispatcher";
import { translateForDriver } from "../ai/translate";

/**
 * Refrigerated loads, the way a reefer dispatcher watches them: the set point and mode from the rate con go to the
 * driver with the load, the trailer is pre-cooled, the pulp temperature is checked before signing the BOL, and the
 * unit's reading is asked for once loaded and before delivery. Every reading is kept on the load (it's what wins or
 * loses a temperature claim), and one out of range reaches the driver and the owner at once.
 */

/** How far off the set point a reading can be before it's a problem, when the rate con gives no range. */
const SLACK_F = 2;
const HOUR = 3600_000;

export function reeferTerms(load: Load): ReeferTerms | null {
  const r = load.rateConReading?.reefer;
  if (r && (r.setF !== null || r.minF !== null || r.maxF !== null)) return r;
  // A broker's email or notes that say "34F continuous" when there's no rate con reading yet.
  const text = `${load.commodity ?? ""} ${load.appointmentNote ?? ""}`;
  const m = text.match(/(-?\d{1,2})\s*°?\s*F\b/i);
  if (load.equipmentType !== "Reefer" || !m) return null;
  return { setF: Number(m[1]), minF: null, maxF: null, mode: /cycle|start.?stop/i.test(text) ? "cycle" : /continuous/i.test(text) ? "continuous" : null, preCool: /pre-?cool/i.test(text) };
}

export function allowedRange(t: ReeferTerms): [number, number] | null {
  if (t.minF !== null || t.maxF !== null) return [t.minF ?? -40, t.maxF ?? 120];
  return t.setF !== null ? [t.setF - SLACK_F, t.setF + SLACK_F] : null;
}

/** What the driver needs to set, in English: "Reefer: 34°F, continuous. Pre-cool before pickup." */
export function reeferLine(load: Load): string | null {
  const t = reeferTerms(load);
  if (!t) return null;
  const temp = t.setF !== null ? `${t.setF}°F` : t.minF !== null && t.maxF !== null ? `${t.minF}–${t.maxF}°F` : t.maxF !== null ? `at or under ${t.maxF}°F` : `at or over ${t.minF}°F`;
  return `Reefer: ${temp}${t.mode ? `, ${t.mode === "continuous" ? "continuous" : "start/stop"}` : ""}.${t.preCool || t.setF !== null ? " Pre-cool before you back in, and check the pulp temp before you sign the BOL." : ""}`;
}

/** A reading from the driver (or a photo of the display): kept, and checked against what the load needs. */
export async function recordReefer(ctx: CarrierContext, driver: Driver, load: Load, tempF: number, pulp: boolean, by: "driver" | "photo"): Promise<string> {
  const at = new Date().toISOString();
  const fresh = ctx.loads.find((l) => l.id === load.id) ?? load;
  const updated: Load = { ...fresh, reeferLog: [...(fresh.reeferLog ?? []), { at, tempF: Math.round(tempF * 10) / 10, ...(pulp ? { pulp: true } : {}), by }].slice(-200), updatedAt: at };
  await save("loads", ctx.carrier.id, updated as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === updated.id ? updated : l));
  const terms = reeferTerms(updated);
  const range = terms ? allowedRange(terms) : null;
  if (!range) return `Recorded ${tempF}°F on ${load.referenceNumber}. The load doesn't say what temperature it needs, so there's nothing to check it against.`;
  const [lo, hi] = range;
  if (tempF >= lo && tempF <= hi) return `Recorded ${tempF}°F on ${load.referenceNumber}: in range (${lo}–${hi}°F).`;
  const off = tempF < lo ? lo - tempF : tempF - hi;
  const first = driver.name.split(" ")[0];
  if (pulp) {
    // Product loaded warm (or frozen solid) isn't the carrier's fault, if it's on the BOL before signing.
    await passToOwner(ctx, { reason: `${first} read a pulp temperature of ${tempF}°F on ${load.referenceNumber}; the load needs ${lo}–${hi}°F. The driver was told to have it written on the BOL before signing, so a claim isn't on us.`, loadId: load.id, label: "Got it", source: "sms", to: "owner" });
    return `Recorded pulp ${tempF}°F, outside ${lo}–${hi}°F. Don't sign the BOL until the shipper writes the pulp temperature on it. The owner has been told.`;
  }
  await passToOwner(ctx, { reason: `Reefer on ${load.referenceNumber} reads ${tempF}°F; it should be ${lo}–${hi}°F (${off.toFixed(1)}°F off). ${first} was told to check the unit.`, loadId: load.id, critical: off >= 5, label: "Handled", source: "sms", to: "owner" });
  return `Recorded ${tempF}°F, which is ${off.toFixed(1)}°F outside ${lo}–${hi}°F. Check the unit is set to ${terms?.setF ?? `${lo}–${hi}`}°F${terms?.mode === "continuous" ? " on continuous" : ""} with the doors shut, and send a new reading in 30 minutes. If it won't come back, pull over somewhere safe and tell me. The owner has been told.`;
}

/** Asks for a reading once the trailer's loaded and again before delivery, on reefer loads with a temperature. */
export async function reeferRounds(ctx: CarrierContext, now: number): Promise<string[]> {
  if (!canText(ctx.carrier)) return [];
  const done: string[] = [];
  for (const load of ctx.loads) {
    const terms = reeferTerms(load);
    if (!terms || !["in_transit", "at_delivery"].includes(load.stage)) continue;
    const truck = ctx.trucks.find((t) => t.id === load.truckId);
    const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
    const to = driver ? toE164(driver.phone) : null;
    if (!driver || !to || driver.prefs?.smsOptOut) continue;
    const loadedAt = Date.parse(load.tripChecklist?.loadedAt ?? load.updatedAt);
    const since = (t: number) => (load.reeferLog ?? []).some((r) => Date.parse(r.at) >= t);
    let kind: "reefer_loaded" | "reefer_delivery" | null = null;
    if (load.stage === "in_transit" && now - loadedAt > 30 * 60_000 && !since(loadedAt)) kind = "reefer_loaded";
    else if (load.stage === "at_delivery" && !since(now - 6 * HOUR)) kind = "reefer_delivery";
    if (!kind || !(await claimMark(ctx.carrier.id, load.id, kind))) continue;
    const ask = kind === "reefer_loaded"
      ? `${load.referenceNumber}: what's the reefer reading now, and what pulp temp did you get at the dock? It should be ${terms.setF !== null ? `${terms.setF}°F` : "in range"}.`
      : `${load.referenceNumber}: before they unload, what's the reefer reading? A photo of the display works too.`;
    const text = await translateForDriver(ask, driver.prefs?.language ?? "en");
    const sid = await textTo(ctx.carrier, to, text);
    await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date(now).toISOString(), channel: "sms", ai: true });
    await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind, loadId: load.id } });
    done.push(`${load.referenceNumber}: asked for the reefer reading`);
  }
  return done;
}

/** The temperature record for a claim file: every reading, in order. */
export function reeferRecord(load: Load): string[] {
  return (load.reeferLog ?? []).map((r) => `${new Date(r.at).toISOString().slice(0, 16).replace("T", " ")} UTC: ${r.tempF}°F${r.pulp ? " (pulp)" : ""}, from the ${r.by === "photo" ? "driver's photo" : "driver"}`);
}
