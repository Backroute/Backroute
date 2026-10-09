import "server-only";
import { APP_LINK } from "../channels/phrases";
import { canText, sandboxed, textTo } from "../channels/out";
import { toE164 } from "../cloud/phone";
import { hourAtStop } from "../stop-time";
import type { Driver } from "../types";
import { admin, claimMark, logChannel, releaseMark, type CarrierContext, type CarrierRow } from "./db";

export type AppLinkReason = "no_phone" | "owner" | "opted_out" | "sms_off" | "practice" | "already_sent" | "text_failed";

/**
 * Texts a driver the link to the driver app, once ever. Not in practice mode: nothing would leave, and the link has to
 * go out for real once the carrier is live (the rounds send it then). The owner-operator is the owner and is already
 * in; a driver who texted STOP gets nothing. If the text fails the mark is given back so the rounds try again.
 */
export async function sendAppLink(carrier: Pick<CarrierRow, "id" | "name" | "owner_phone" | "settings">, driver: Driver, url: string): Promise<{ texted: boolean; reason?: AppLinkReason }> {
  const phone = toE164(driver.phone);
  if (!phone) return { texted: false, reason: "no_phone" };
  if (carrier.owner_phone && toE164(carrier.owner_phone) === phone) return { texted: false, reason: "owner" };
  if (driver.prefs?.smsOptOut) return { texted: false, reason: "opted_out" };
  if (sandboxed(carrier)) return { texted: false, reason: "practice" };
  if (!canText(carrier)) return { texted: false, reason: "sms_off" };
  if (!(await claimMark(carrier.id, `app:${driver.id}`, "app_link"))) return { texted: false, reason: "already_sent" };
  const body = APP_LINK[driver.prefs?.language ?? "en"](carrier.name, url);
  try {
    const sid = await textTo(carrier, phone, body);
    await logChannel({ carrierId: carrier.id, channel: "sms", direction: "out", providerId: sid || null, driverId: driver.id, counterparty: phone, body, data: { kind: "app_link" } });
    return { texted: true };
  } catch (e) {
    console.error("[app-link] text failed", driver.id, e);
    await releaseMark(carrier.id, `app:${driver.id}`, "app_link");
    return { texted: false, reason: "text_failed" };
  }
}

/**
 * Drivers let in who haven't signed in yet and were never sent the link: a carrier made with the pilot script, or one
 * that just moved from practice to live. Sent in the driver's daytime (APP_LINK_HOURS, default 8-20, where they are).
 */
export async function appLinkRounds(ctx: CarrierContext, now: number, base: string | null): Promise<string[]> {
  if (!base || sandboxed(ctx.carrier) || !canText(ctx.carrier)) return [];
  const [{ data: invites }, { data: sent }] = await Promise.all([
    admin().from("invites").select("driver_id").eq("carrier_id", ctx.carrier.id).eq("role", "driver").not("driver_id", "is", null),
    admin().from("agent_marks").select("load_id").eq("carrier_id", ctx.carrier.id).eq("kind", "app_link"),
  ]);
  const already = new Set((sent ?? []).map((m) => String(m.load_id)));
  const [from, to] = (process.env.APP_LINK_HOURS ?? "8-20").split("-").map(Number);
  const done: string[] = [];
  for (const { driver_id } of invites ?? []) {
    const driver = ctx.drivers.find((d) => d.id === driver_id);
    if (!driver || already.has(`app:${driver.id}`)) continue;
    const truck = ctx.trucks.find((t) => t.driverId === driver.id || t.secondDriverId === driver.id);
    const state = truck?.currentState || driver.homeBase?.split(",")[1]?.trim() || "TX";
    const hour = hourAtStop(state, now);
    if (hour < from || hour >= to) continue;
    if ((await sendAppLink(ctx.carrier, driver, `${base}/login`)).texted) done.push(`${driver.name} texted the app link`);
  }
  return done;
}
