import "server-only";
import { admin } from "./db";

/** A carrier's connections to outside services, kept server-side (see migration 20260927000000_support.sql). */

export type IntegrationKind = "samsara" | "motive" | "load_feed" | "truckstop" | "dat" | `board:${string}`;

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

/** Truckstop: the carrier's Integration ID (Backroute holds the partner web-service login). */
export interface TruckstopConfig {
  integrationId: string;
  /** Post the carrier's empty trucks on Truckstop too. */
  postTrucks?: boolean;
}
/** DAT: the carrier's DAT user (their login email); Backroute's service account is in the environment. */
export interface DatConfig {
  userEmail: string;
  postTrucks?: boolean;
}
/** Any other board with an API, described by how to search it and where the fields are (lib/agent/boards/custom). */
export interface CustomBoardConfig {
  name: string;
  searchUrl: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  listPath: string;
  fields: Record<string, string>;
}
export type AnyConfig = EldConfig | FeedConfig | TruckstopConfig | DatConfig | CustomBoardConfig;

export interface IntegrationRow {
  carrier_id: string;
  kind: IntegrationKind;
  config: AnyConfig;
  status: string | null;
  checked_at: string | null;
}

export async function integrationsFor(carrierId: string): Promise<IntegrationRow[]> {
  const { data, error } = await admin().from("carrier_integrations").select("carrier_id, kind, config, status, checked_at").eq("carrier_id", carrierId);
  if (error) throw error;
  return (data ?? []) as IntegrationRow[];
}

export async function saveIntegration(carrierId: string, kind: IntegrationKind, config: AnyConfig, status: string) {
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
