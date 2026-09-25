import "server-only";
import { admin } from "./db";

/** A carrier's connections to outside services, kept server-side (see migration 20260927000000_support.sql). */

export type IntegrationKind = "samsara" | "motive" | "load_feed";

export interface EldConfig {
  apiKey: string;
}
export interface FeedConfig {
  url: string;
  format: "json" | "csv";
  /** An optional header the feed needs, e.g. Authorization: Bearer … */
  headerName?: string;
  headerValue?: string;
  name?: string;
}

export interface IntegrationRow {
  carrier_id: string;
  kind: IntegrationKind;
  config: EldConfig | FeedConfig;
  status: string | null;
  checked_at: string | null;
}

export async function integrationsFor(carrierId: string): Promise<IntegrationRow[]> {
  const { data, error } = await admin().from("carrier_integrations").select("carrier_id, kind, config, status, checked_at").eq("carrier_id", carrierId);
  if (error) throw error;
  return (data ?? []) as IntegrationRow[];
}

export async function saveIntegration(carrierId: string, kind: IntegrationKind, config: EldConfig | FeedConfig, status: string) {
  const { error } = await admin()
    .from("carrier_integrations")
    .upsert({ carrier_id: carrierId, kind, config, status, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "carrier_id,kind" });
  if (error) throw error;
}

export async function setStatus(carrierId: string, kind: IntegrationKind, status: string) {
  await admin().from("carrier_integrations").update({ status, checked_at: new Date().toISOString() }).eq("carrier_id", carrierId).eq("kind", kind);
}

export async function removeIntegration(carrierId: string, kind: IntegrationKind) {
  await admin().from("carrier_integrations").delete().eq("carrier_id", carrierId).eq("kind", kind);
}
