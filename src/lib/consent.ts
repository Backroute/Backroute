import "server-only";
import { admin } from "./agent/db";
import type { Driver } from "./types";
import { CONSENT_VERSION, FIRST_TEXT, type ConsentVia } from "./consent-words";
import { last10, sendText } from "./channels/texting";

/**
 * A driver's consent to texts and calls from the dispatch line (docs/legal/driver-text-consent.md): the owner says the
 * driver agreed when adding them, the driver agrees in the app, or answers YES to the first text; STOP and START are
 * recorded too. Every record is kept as it was written (the table refuses changes), with the words the person saw.
 */

export { CONSENT_VERSION, DRIVER_AGREES, FIRST_TEXT, OWNER_ATTESTS, THANKS_YES, type ConsentVia } from "./consent-words";

interface ConsentRecord {
  driverId: string;
  granted: boolean;
  via: ConsentVia;
  at: string;
  version: string;
}

export async function recordConsent(p: { carrierId: string; driverId: string; phone?: string | null; granted: boolean; via: ConsentVia; wording: string; byUser?: string | null; ip?: string | null; userAgent?: string | null }) {
  const { error } = await admin()
    .from("driver_consents")
    .insert({ carrier_id: p.carrierId, driver_id: p.driverId, phone: p.phone ?? null, granted: p.granted, via: p.via, wording: p.wording.slice(0, 2000), version: CONSENT_VERSION, by_user: p.byUser ?? null, ip: p.ip ?? null, user_agent: p.userAgent?.slice(0, 300) ?? null });
  if (error) throw error;
}

/** Each driver's latest answer, by driver id. */
export async function consentsFor(carrierId: string): Promise<Map<string, ConsentRecord>> {
  const { data, error } = await admin().from("driver_consents").select("driver_id, granted, via, at, version").eq("carrier_id", carrierId).order("at", { ascending: false }).limit(2000);
  if (error) throw error;
  const out = new Map<string, ConsentRecord>();
  for (const r of data ?? []) if (!out.has(r.driver_id as string)) out.set(r.driver_id as string, { driverId: r.driver_id as string, granted: r.granted as boolean, via: r.via as ConsentVia, at: r.at as string, version: r.version as string });
  return out;
}

/** Texts to this driver wait for their yes (CONSENT_REQUIRED=1 and they haven't said it): nothing is claimed or sent. */
export async function textsHeld(carrierId: string, driverId: string): Promise<boolean> {
  return consentRequired() && !(await consentOf(carrierId, driverId))?.granted;
}

async function consentOf(carrierId: string, driverId: string): Promise<ConsentRecord | null> {
  const { data } = await admin().from("driver_consents").select("driver_id, granted, via, at, version").eq("carrier_id", carrierId).eq("driver_id", driverId).order("at", { ascending: false }).limit(1);
  const r = data?.[0];
  return r ? { driverId: r.driver_id as string, granted: r.granted as boolean, via: r.via as ConsentVia, at: r.at as string, version: r.version as string } : null;
}

/**
 * What happens to a text to this number, decided once per text:
 * - `notice`: a driver of this carrier who hasn't said yes anywhere gets the first text (who's texting, how to stop)
 *   before anything else, once per number. Not the owner, who signed up themselves (an owner-operator is both).
 * - `hold`: with CONSENT_REQUIRED=1, nothing else goes to that driver until they say yes (the texts wait, and go
 *   out when they do). Off by default until your lawyer says which way (docs/legal/driver-text-consent.md).
 * - `appOnly`: the driver asked for notifications instead of texts and has a phone that's taking them.
 */
export interface Recipient {
  driverId: string | null;
  notice: string | null;
  hold: boolean;
  appOnly: boolean;
}

const consentRequired = () => process.env.CONSENT_REQUIRED === "1";

export async function recipientPolicy(carrierId: string, to: string): Promise<Recipient> {
  const none: Recipient = { driverId: null, notice: null, hold: false, appOnly: false };
  const key = last10(to);
  if (key.length !== 10) return none;
  const [{ data: drivers }, { data: carrier }] = await Promise.all([
    admin().from("drivers").select("data").eq("carrier_id", carrierId).eq("phone_last10", key).limit(1),
    admin().from("carriers").select("name, owner_phone").eq("id", carrierId).maybeSingle(),
  ]);
  const driver = drivers?.[0]?.data as Driver | undefined;
  if (!driver) return none;
  // The owner (an owner-operator drives too) agreed to Backroute's terms when they signed up.
  if (carrier?.owner_phone && last10(carrier.owner_phone as string) === key) return { ...none, driverId: driver.id };
  const latest = await consentOf(carrierId, driver.id);
  const appOnly = driver.prefs?.textsToo === false && (await activeDevice(carrierId, driver.id));
  if (latest?.granted) return { driverId: driver.id, notice: null, hold: false, appOnly };
  // Someone who texted STOP gets nothing, not even the notice (the provider blocks it anyway).
  if (latest && !latest.granted) return { driverId: driver.id, notice: null, hold: consentRequired(), appOnly };
  // Claimed atomically: two texts at once still bring one notice.
  const at = new Date().toISOString();
  await admin().from("text_routes").upsert({ phone_last10: key, updated_at: at }, { onConflict: "phone_last10", ignoreDuplicates: true });
  const { data: claimed } = await admin().from("text_routes").update({ notice_at: at, updated_at: at }).eq("phone_last10", key).is("notice_at", null).select("phone_last10");
  const notice = claimed?.length ? FIRST_TEXT[driver.prefs?.language ?? "en"]((carrier?.name as string) ?? "Your carrier") : null;
  return { driverId: driver.id, notice, hold: consentRequired(), appOnly };
}

/** A phone of this driver's that took a notification in the last two weeks. */
async function activeDevice(carrierId: string, driverId: string): Promise<boolean> {
  const { data: them } = await admin().from("members").select("user_id").eq("carrier_id", carrierId).eq("driver_id", driverId);
  if (!them?.length) return false;
  const { count } = await admin()
    .from("push_subscriptions")
    .select("endpoint", { head: true, count: "exact" })
    .eq("carrier_id", carrierId)
    .in("user_id", them.map((m) => m.user_id as string))
    .gte("last_ok_at", new Date(Date.now() - 14 * 86400_000).toISOString());
  return (count ?? 0) > 0;
}

/** Texts held for a driver's yes (CONSENT_REQUIRED=1), sent once they give it: the ones from the last day. */
export async function releaseHeld(carrierId: string, phone: string | null | undefined, send: (to: string, body: string) => Promise<unknown> = (to, body) => sendText(to, body)): Promise<number> {
  if (!phone || last10(phone).length !== 10) return 0;
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { data } = await admin().from("outbound").select("id, recipient, body").eq("carrier_id", carrierId).eq("status", "held").eq("channel", "sms").eq("data->>reason", "no_consent").like("recipient", `%${last10(phone)}`).gte("created_at", since).order("created_at");
  let sent = 0;
  for (const row of data ?? []) {
    try {
      await send(row.recipient as string, (row.body as string) ?? "");
      await admin().from("outbound").update({ status: "sent" }).eq("id", row.id);
      sent++;
    } catch (e) {
      console.error("[consent] couldn't send a held text", e);
    }
  }
  return sent;
}

/** Whether the first text went out lately and this is the answer to it. */
export async function awaitingYes(carrierId: string, driverId: string, phone: string): Promise<boolean> {
  const { data } = await admin().from("text_routes").select("notice_at").eq("phone_last10", last10(phone)).maybeSingle();
  if (!data?.notice_at || Date.now() - Date.parse(data.notice_at as string) > 14 * 86400_000) return false;
  const latest = await consentOf(carrierId, driverId);
  return !latest;
}
