import "server-only";
import { admin } from "./agent/db";
import type { Driver } from "./types";
import { CONSENT_VERSION, FIRST_TEXT, type ConsentVia } from "./consent-words";
import { last10 } from "./channels/texting";

/**
 * A driver's consent to texts and calls from the dispatch line (docs/legal/driver-text-consent.md): the owner says the
 * driver agreed when adding them, the driver agrees in the app, or answers YES to the first text; STOP and START are
 * recorded too. Every record is kept as it was written (the table refuses changes), with the words the person saw.
 */

export { CONSENT_VERSION, DRIVER_AGREES, FIRST_TEXT, OWNER_ATTESTS, THANKS_YES, type ConsentVia } from "./consent-words";

export interface ConsentRecord {
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

export async function consentOf(carrierId: string, driverId: string): Promise<ConsentRecord | null> {
  const { data } = await admin().from("driver_consents").select("driver_id, granted, via, at, version").eq("carrier_id", carrierId).eq("driver_id", driverId).order("at", { ascending: false }).limit(1);
  const r = data?.[0];
  return r ? { driverId: r.driver_id as string, granted: r.granted as boolean, via: r.via as ConsentVia, at: r.at as string, version: r.version as string } : null;
}

/**
 * Before the first text to a driver of this carrier who hasn't said yes anywhere: the text that says who's texting
 * and how to stop it. Returned once per phone number (null after that, or for anyone who isn't this carrier's driver).
 */
export async function firstTextFor(carrierId: string, to: string): Promise<string | null> {
  const key = last10(to);
  if (key.length !== 10) return null;
  const { data: drivers } = await admin().from("drivers").select("data").eq("carrier_id", carrierId).eq("phone_last10", key).limit(1);
  const driver = drivers?.[0]?.data as Driver | undefined;
  if (!driver) return null;
  if ((await consentOf(carrierId, driver.id))?.granted) return null;
  // Claimed atomically: two texts at once still bring one notice.
  const at = new Date().toISOString();
  await admin().from("text_routes").upsert({ phone_last10: key, updated_at: at }, { onConflict: "phone_last10", ignoreDuplicates: true });
  const { data: claimed } = await admin().from("text_routes").update({ notice_at: at, updated_at: at }).eq("phone_last10", key).is("notice_at", null).select("phone_last10");
  if (!claimed?.length) return null;
  const { data: carrier } = await admin().from("carriers").select("name").eq("id", carrierId).maybeSingle();
  return FIRST_TEXT[driver.prefs?.language ?? "en"]((carrier?.name as string) ?? "Your carrier");
}

/** Whether the first text went out lately and this is the answer to it. */
export async function awaitingYes(carrierId: string, driverId: string, phone: string): Promise<boolean> {
  const { data } = await admin().from("text_routes").select("notice_at").eq("phone_last10", last10(phone)).maybeSingle();
  if (!data?.notice_at || Date.now() - Date.parse(data.notice_at as string) > 14 * 86400_000) return false;
  const latest = await consentOf(carrierId, driverId);
  return !latest;
}
