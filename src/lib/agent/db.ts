import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rowFor, conflictKey, type Item, type RecordKind, type Table } from "../cloud/rows";
import type { AgentSettings } from "../store";
import type { ActivityEvent, Broker, Driver, DriverMessage, Escalation, Load, Truck } from "../types";

/**
 * The AI dispatcher's access to the database, on the server. It uses the service role key, which skips the access
 * rules, so every function here takes the carrier and filters by it. Never import this into anything a browser runs.
 */

let client: SupabaseClient | null = null;

export const dbConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the AI dispatcher.");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export interface CarrierRow {
  id: string;
  name: string;
  mc: string | null;
  owner_operator: boolean;
  owner_phone: string | null;
  inbound_key: string;
  settings: Partial<AgentSettings>;
}

/** Everything the AI needs to know about one carrier to act for it. */
export interface CarrierContext {
  carrier: CarrierRow;
  settings: AgentSettings;
  drivers: Driver[];
  trucks: Truck[];
  loads: Load[];
  escalations: Escalation[];
  brokers: Broker[];
}

/** What a carrier who never changed a setting gets: the AI asks before anything that commits the carrier. */
const DEFAULT_SETTINGS: Pick<AgentSettings, "autonomy" | "rateFloorPct" | "ownerLanguage" | "ownerOperator" | "dailyText"> = {
  autonomy: "ask",
  rateFloorPct: 96,
  ownerLanguage: "en",
  ownerOperator: false,
  dailyText: true,
};

async function rows<T>(table: Table, carrierId: string, kind?: RecordKind, limit = 1000): Promise<T[]> {
  let q = admin().from(table).select("data").eq("carrier_id", carrierId);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.data as T);
}

export async function carrierById(carrierId: string): Promise<CarrierRow | null> {
  const { data, error } = await admin().from("carriers").select("id, name, mc, owner_operator, owner_phone, inbound_key, settings").eq("id", carrierId).maybeSingle();
  if (error) throw error;
  return data as CarrierRow | null;
}

export async function carrierByInboundKey(key: string): Promise<CarrierRow | null> {
  const { data, error } = await admin().from("carriers").select("id, name, mc, owner_operator, owner_phone, inbound_key, settings").eq("inbound_key", key).maybeSingle();
  if (error) throw error;
  return data as CarrierRow | null;
}

export async function loadContext(carrierId: string): Promise<CarrierContext | null> {
  const carrier = await carrierById(carrierId);
  if (!carrier) return null;
  const [drivers, trucks, loads, escalations, brokers] = await Promise.all([
    rows<Driver>("drivers", carrierId),
    rows<Truck>("trucks", carrierId),
    rows<Load>("loads", carrierId, undefined, 300),
    rows<Escalation>("escalations", carrierId, undefined, 100),
    rows<Broker>("records", carrierId, "broker"),
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...carrier.settings, ownerOperator: carrier.owner_operator } as AgentSettings;
  return { carrier, settings, drivers, trucks, loads, escalations, brokers };
}

/** The driver a text or call came from, by the last 10 digits of the number. First carrier wins if they drive for two. */
export async function driverByPhone(phone: string): Promise<{ carrierId: string; driver: Driver } | null> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return null;
  const { data, error } = await admin().from("drivers").select("carrier_id, data").eq("phone_last10", last10).limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? { carrierId: row.carrier_id as string, driver: row.data as Driver } : null;
}

export async function save(table: Table, carrierId: string, item: Item, kind?: RecordKind) {
  const { error } = await admin().from(table).upsert(rowFor(table, kind, carrierId, item), { onConflict: conflictKey(kind) });
  if (error) throw error;
}

export async function addActivity(carrierId: string, event: ActivityEvent) {
  await save("activity", carrierId, event as unknown as Item);
}

/** The driver's thread (app and text), oldest first. */
export async function driverThread(carrierId: string, driverId: string, limit = 12): Promise<DriverMessage[]> {
  const { data, error } = await admin()
    .from("driver_messages")
    .select("data")
    .eq("carrier_id", carrierId)
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.data as DriverMessage).reverse();
}

export async function saveDriverMessage(carrierId: string, message: DriverMessage) {
  await save("driver_messages", carrierId, message as unknown as Item);
}

export interface ChannelLog {
  carrierId: string;
  channel: "sms" | "voice" | "email";
  direction: "in" | "out";
  providerId?: string | null;
  driverId?: string | null;
  counterparty?: string | null;
  body?: string | null;
  data?: Record<string, unknown>;
}

/** Logs a text, call turn or email. Returns false when the provider already delivered this one (a retry). */
export async function logChannel(entry: ChannelLog): Promise<boolean> {
  const { error } = await admin()
    .from("channel_messages")
    .insert({
      carrier_id: entry.carrierId,
      channel: entry.channel,
      direction: entry.direction,
      provider_id: entry.providerId ?? null,
      driver_id: entry.driverId ?? null,
      counterparty: entry.counterparty ?? null,
      body: entry.body ?? null,
      data: entry.data ?? {},
    });
  if (error?.code === "23505") return false;
  if (error) throw error;
  return true;
}

/** Earlier messages with one counterparty on a channel (an email address, or "call:<sid>" for one phone call), oldest first. */
export async function threadWith(carrierId: string, channel: "sms" | "voice" | "email", counterparty: string, limit = 8) {
  const { data, error } = await admin()
    .from("channel_messages")
    .select("direction, body, data, created_at")
    .eq("carrier_id", carrierId)
    .eq("channel", channel)
    .eq("counterparty", counterparty.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}

