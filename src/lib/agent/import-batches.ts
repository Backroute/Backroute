import "server-only";
import { randomBytes } from "crypto";
import { admin } from "./db";

/**
 * Each import of the carrier's history (a spreadsheet, a batch of rate cons, an email to the history address) is one
 * batch, so the owner can take it back out if it brought in the wrong things: its loads, and the brokers it added
 * that nothing else uses. Kept as a mark for 90 days; the loads carry the batch's id.
 */

const KIND = "import_batch";
const keyOf = (batch: string) => `import:${batch}`;

interface ImportBatch {
  id: string;
  at: string;
  via: "spreadsheet" | "upload" | "email";
  label: string;
  loads: number;
  brokerIds: string[];
}

export const newBatchId = () => `imp_${Array.from(randomBytes(10), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("")}`;
export const validBatchId = (id: unknown): id is string => typeof id === "string" && /^imp_[a-z0-9]{10}$/.test(id);

/** Adds what one request brought in to its batch (an upload sent in parts adds to the same one). */
export async function recordBatch(carrierId: string, batch: string, add: { via: ImportBatch["via"]; label: string; loads: number; brokerIds: string[] }) {
  if (!add.loads && !add.brokerIds.length) return;
  const db = admin();
  const { data } = await db.from("agent_marks").select("data").eq("carrier_id", carrierId).eq("load_id", keyOf(batch)).eq("kind", KIND).maybeSingle();
  const was = (data?.data ?? null) as ImportBatch | null;
  const next: ImportBatch = {
    id: batch,
    at: was?.at ?? new Date().toISOString(),
    via: add.via,
    label: was?.label ?? add.label,
    loads: (was?.loads ?? 0) + add.loads,
    brokerIds: [...new Set([...(was?.brokerIds ?? []), ...add.brokerIds])],
  };
  const { error } = await db.from("agent_marks").upsert({ carrier_id: carrierId, load_id: keyOf(batch), kind: KIND, data: next }, { onConflict: "carrier_id,load_id,kind" });
  if (error) throw error;
}

/** The carrier's imports in the last 90 days, newest first. */
export async function recentBatches(carrierId: string): Promise<ImportBatch[]> {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data, error } = await admin().from("agent_marks").select("data").eq("carrier_id", carrierId).eq("kind", KIND).gte("created_at", since).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => r.data as ImportBatch);
}

/**
 * Takes an import back out: its loads (only ones still marked imported, never a load the AI is running), and the
 * brokers it added that no other load uses now.
 */
export async function undoBatch(carrierId: string, batch: string): Promise<{ loads: number; brokers: number } | null> {
  const db = admin();
  const { data: mark } = await db.from("agent_marks").select("data").eq("carrier_id", carrierId).eq("load_id", keyOf(batch)).eq("kind", KIND).maybeSingle();
  if (!mark) return null;
  const info = mark.data as ImportBatch;
  const { data: gone, error } = await db.from("loads").delete().eq("carrier_id", carrierId).eq("data->>importBatch", batch).eq("data->>imported", "true").select("id");
  if (error) throw error;
  let brokers = 0;
  if (info.brokerIds.length) {
    const { data: used } = await db.from("loads").select("data->>brokerId").eq("carrier_id", carrierId).in("data->>brokerId", info.brokerIds);
    const stillUsed = new Set((used ?? []).map((r) => (r as Record<string, string>).brokerId));
    const unused = info.brokerIds.filter((id) => !stillUsed.has(id));
    if (unused.length) {
      const { data: removed, error: e2 } = await db.from("records").delete().eq("carrier_id", carrierId).eq("kind", "broker").in("id", unused).select("id");
      if (e2) throw e2;
      brokers = removed?.length ?? 0;
    }
  }
  await db.from("agent_marks").delete().eq("carrier_id", carrierId).eq("load_id", keyOf(batch)).eq("kind", KIND);
  return { loads: gone?.length ?? 0, brokers };
}
