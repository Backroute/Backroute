import "server-only";
import { WEEKLY_CHECKIN, WEEKLY_PAY } from "../channels/phrases";
import { sendSms, twilioConfigured } from "../channels/twilio";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { hourAtStop } from "../stop-time";
import { placeCoords, roadMiles } from "../trip-geo";
import type { Driver } from "../types";
import { addActivity, claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { event, passToOwner, uid } from "./dispatcher";

/**
 * The part of dispatching that keeps drivers: asking how it's going every week, noticing when someone's unhappy or
 * hasn't been home in a long time, and being straight about pay. The AI asks and listens; anything about pay, time
 * off or a driver thinking of leaving goes to the owner, who decides.
 */

const DAY = 86400_000;
const HOME_MILES = 30;
const LONG_AWAY_DAYS = 21;

/** Hours of the driver's local day the AI texts in (CARE_HOURS="9-20" by default). */
function textingHours(): [number, number] {
  const [a, b] = (process.env.CARE_HOURS ?? "9-20").split("-").map(Number);
  return [Number.isFinite(a) ? a : 9, Number.isFinite(b) ? b : 20];
}

const stateOf = (d: Driver) => d.homeBase?.split(",")[1]?.trim() || "TX";
const isoWeek = (now: number) => {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY))).padStart(2, "0")}`;
};

async function text(ctx: CarrierContext, driver: Driver, body: string, kind: string) {
  const to = toE164(driver.phone);
  if (!to || driver.prefs?.smsOptOut) return false;
  const sid = await sendSms(to, body);
  await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: body, timestamp: new Date().toISOString(), channel: "sms", ai: true });
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body, data: { kind } });
  return true;
}

async function saveDriver(ctx: CarrierContext, driver: Driver) {
  await save("drivers", ctx.carrier.id, driver as unknown as Item);
  ctx.drivers = ctx.drivers.map((d) => (d.id === driver.id ? driver : d));
}

/** The ELD had the truck at the driver's home: note it. A long stretch without that goes to the owner once a week. */
export async function trackHomeTime(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const truck of ctx.trucks) {
    const driver = ctx.drivers.find((d) => d.id === truck.driverId);
    const p = truck.position;
    if (!driver?.homeBase || !p || Date.parse(p.at) < now - 2 * 3600_000) continue;
    const [city, state] = driver.homeBase.split(",").map((s) => s.trim());
    const home = placeCoords(city, state);
    if (home && roadMiles([p.lat, p.lon], home) <= HOME_MILES) {
      if (!driver.lastHomeAt || Date.parse(driver.lastHomeAt) < now - 3600_000) await saveDriver(ctx, { ...driver, lastHomeAt: new Date(now).toISOString() });
      continue;
    }
    const away = driver.lastHomeAt ? Math.floor((now - Date.parse(driver.lastHomeAt)) / DAY) : null;
    if (away !== null && away >= LONG_AWAY_DAYS && (await claimMark(ctx.carrier.id, `driver:${driver.id}`, `long_away:${isoWeek(now)}`))) {
      await passToOwner(ctx, {
        reason: `${driver.name} hasn't been home in ${away} days (going by the ELD). Drivers who stay out this long start looking elsewhere. Want the AI to route ${driver.name.split(" ")[0]} home? Turn on "Get ${driver.name.split(" ")[0]} home first" on the Fleet page.`,
        label: "Got it",
        source: "app",
        to: "owner",
      });
      done.push(`${driver.name}: ${away} days from home, owner told`);
    }
  }
  return done;
}

/** Once a week, in the driver's language and waking hours: how's it going? And, if the owner turned it on, their pay. */
export async function weeklyCare(ctx: CarrierContext, now: number): Promise<string[]> {
  if (!twilioConfigured()) return [];
  const done: string[] = [];
  const week = isoWeek(now);
  const [from, to] = textingHours();
  for (const driver of ctx.drivers) {
    const hour = hourAtStop(stateOf(driver), now);
    if (hour < from || hour >= to) continue;
    const lang = driver.prefs?.language ?? "en";
    const first = driver.name.split(" ")[0];
    if (ctx.settings.driverCheckins !== false && (await claimMark(ctx.carrier.id, `driver:${driver.id}`, `care:${week}`))) {
      if (await text(ctx, driver, WEEKLY_CHECKIN[lang](first, ctx.carrier.name), "weekly_checkin")) done.push(`${first}: weekly check-in`);
    }
    if (ctx.settings.payTexts && (await claimMark(ctx.carrier.id, `driver:${driver.id}`, `pay:${week}`))) {
      const since = now - 7 * DAY;
      const trucks = new Set(ctx.trucks.filter((t) => t.driverId === driver.id || t.secondDriverId === driver.id).map((t) => t.id));
      const loads = ctx.loads.filter((l) => l.stage === "delivered" && l.truckId && trucks.has(l.truckId) && Date.parse(l.updatedAt) >= since);
      const miles = loads.reduce((s, l) => s + l.lane.miles, 0);
      const gross = loads.reduce((s, l) => s + (l.bookedRate ?? l.targetRate ?? 0), 0);
      // Hourly and per-move pay depend on hours and moves the AI doesn't have; those drivers get the check-in only.
      const pay = driver.payType === "per_mile" ? miles * driver.payRate : driver.payType === "percentage" ? (gross * driver.payRate) / 100 : null;
      if (pay !== null && loads.length) {
        const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const body = WEEKLY_PAY[lang]({ loads: loads.length, miles: miles.toLocaleString("en-US"), pay: `$${Math.round(pay).toLocaleString("en-US")}`, from: fmt(since), to: fmt(now) });
        if (await text(ctx, driver, body, "weekly_pay")) done.push(`${first}: weekly pay text`);
      }
    }
  }
  return done;
}

/** What the driver said about how things are going (the driver brain calls this). Unhappy or asking for something: the owner hears. */
export async function recordFeedback(ctx: CarrierContext, driver: Driver, f: { mood: "good" | "ok" | "bad"; note?: string; homeBy?: string; wantsOwner?: boolean }): Promise<string> {
  const at = new Date().toISOString();
  const homeBy = f.homeBy && /^\d{4}-\d{2}-\d{2}$/.test(f.homeBy) && Date.parse(f.homeBy) > Date.now() ? f.homeBy : undefined;
  const next: Driver = { ...driver, care: { at, mood: f.mood, note: f.note, homeBy }, lastCheckInAt: at, ...(homeBy && driver.runType === "otr" ? { homeDueAt: `${homeBy}T17:00:00.000Z` } : {}) };
  await saveDriver(ctx, next);
  const first = driver.name.split(" ")[0];
  await addActivity(ctx.carrier.id, event({ type: "call_completed", message: `${first}'s check-in: ${f.mood === "good" ? "doing well" : f.mood === "ok" ? "doing OK" : "not happy"}`, detail: f.note ?? "", severity: f.mood === "bad" ? "warning" : "info" }));
  const said: string[] = [];
  if (homeBy) said.push(`wants to be home by ${homeBy}${driver.runType === "otr" ? "; the AI is planning loads to get there" : ""}`);
  if (f.mood === "bad" || f.wantsOwner) {
    await passToOwner(ctx, {
      reason: `${driver.name} ${f.mood === "bad" ? "isn't happy" : "wants to talk to you"}: ${f.note ?? "no details"}${said.length ? `. Also ${said.join(", ")}` : ""}. Worth a call from you.`,
      label: "Talked to them",
      source: "sms",
      to: "owner",
    });
    return "Noted, and the owner will call them. Thank them for saying so; don't promise anything about pay or time off.";
  }
  if (homeBy) {
    await passToOwner(ctx, { reason: `${driver.name} ${said.join(", ")}.`, label: "OK", source: "sms", to: "owner" });
    return `Noted: home by ${homeBy}. The AI will plan loads toward home and the owner knows.`;
  }
  return "Noted. Thank them.";
}
