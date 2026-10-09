import "server-only";
import { admin } from "./agent/db";
import { cancelSubscription } from "./billing";

/**
 * A carrier leaving Backroute: everything of theirs to take with them, and deleting the account.
 * Shared by the owner's Settings (api/account) and support's script (scripts/pilot-carrier.mjs, which has its own
 * copy of this list: keep the two the same).
 */

/** What the export holds, table by table: the columns (never a saved password or an API key), and a stable order. */
export const EXPORT_TABLES: Record<string, { columns: string; order: string }> = {
  drivers: { columns: "id, name, phone, data, updated_at", order: "id" },
  trucks: { columns: "id, unit_number, driver_id, second_driver_id, data, updated_at", order: "id" },
  loads: { columns: "id, truck_id, stage, data, updated_at", order: "id" },
  escalations: { columns: "id, load_id, status, data, updated_at", order: "id" },
  records: { columns: "id, kind, driver_id, data, updated_at", order: "id" },
  activity: { columns: "id, load_id, data, created_at", order: "id" },
  channel_messages: { columns: "id, channel, direction, driver_id, counterparty, body, data, created_at", order: "id" },
  driver_messages: { columns: "id, driver_id, data, created_at", order: "id" },
  dispatch_calls: { columns: "id, driver_id, status, data, updated_at", order: "id" },
  driver_consents: { columns: "id, driver_id, phone, granted, via, wording, version, at", order: "id" },
  held_sends: { columns: "id, load_id, purpose, summary, draft, send_at, status, created_at", order: "id" },
  facility_notes: { columns: "id, name_key, city, state, zip, note, hours, created_at", order: "id" },
  facility_visits: { columns: "load_id, stop, name_key, city, state, minutes, at", order: "at" },
  weekly_reviews: { columns: "week, data, created_at", order: "week" },
  audit_log: { columns: "id, at, who, action, target", order: "id" },
  portal_tasks: { columns: "id, kind, status, url, load_id, created_at, updated_at", order: "id" },
  portal_logins: { columns: "id, kind, site, label, username, created_at", order: "id" },
  carrier_integrations: { columns: "kind, status, checked_at", order: "kind" },
  carrier_files: { columns: "id, kind, load_id, name, content_type, size, expires_on, note, created_at", order: "created_at" },
};

export const PAGE = 1000;

/** One page of one table, for the owner's download (a page at a time keeps each answer small). */
export async function exportPage(carrierId: string, table: string, page: number): Promise<{ rows: unknown[]; more: boolean }> {
  const spec = EXPORT_TABLES[table];
  if (!spec) throw new Error(`not exported: ${table}`);
  const { data, error } = await admin()
    .from(table)
    .select(spec.columns)
    .eq("carrier_id", carrierId)
    .order(spec.order)
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (error) throw error;
  return { rows: data ?? [], more: (data?.length ?? 0) === PAGE };
}

/** The carrier itself, with its billing status (no Stripe ids). */
export async function exportCarrier(carrierId: string) {
  const [{ data: carrier }, { data: billing }] = await Promise.all([
    admin().from("carriers").select("id, name, mc, dot, owner_phone, owner_operator, settings, created_at").eq("id", carrierId).maybeSingle(),
    admin().from("carrier_billing").select("status, trucks, current_period_end, trial_end").eq("carrier_id", carrierId).maybeSingle(),
  ]);
  return { carrier, billing };
}

/**
 * Deletes a carrier and everything of theirs: the subscription is cancelled first (if that fails, nothing is deleted,
 * so nobody is charged for an account that's gone), then the carrier row, which takes every table with it. Drivers'
 * consent records are archived on the way (the database does that). People who signed in only for this carrier are
 * removed from sign-in too. Returns what it did.
 */
export async function deleteCarrier(carrierId: string, by: string): Promise<{ ok: true; removedUsers: number } | { ok: false; reason: "not_found" | "billing" }> {
  const { data: carrier } = await admin().from("carriers").select("id, name, mc").eq("id", carrierId).maybeSingle();
  if (!carrier) return { ok: false, reason: "not_found" };
  try {
    await cancelSubscription(carrierId);
  } catch (e) {
    console.error("[account] couldn't cancel the subscription", carrierId, e);
    return { ok: false, reason: "billing" };
  }
  const { data: members } = await admin().from("members").select("user_id").eq("carrier_id", carrierId);
  await admin().from("closed_accounts").upsert({ carrier_id: carrierId, name: carrier.name, mc: carrier.mc, closed_by: by }, { onConflict: "carrier_id" });
  const { error } = await admin().from("carriers").delete().eq("id", carrierId);
  if (error) throw error;
  await admin().from("service_heartbeats").delete().eq("name", `rounds:${carrierId}`);
  // Sign-ins that belonged only to this carrier go too; someone who also works for another carrier keeps theirs.
  let removedUsers = 0;
  for (const { user_id } of members ?? []) {
    const { count } = await admin().from("members").select("user_id", { count: "exact", head: true }).eq("user_id", user_id);
    if (count) continue;
    const { error: gone } = await admin().auth.admin.deleteUser(user_id as string);
    if (gone) console.error("[account] couldn't remove a sign-in", user_id, gone.message);
    else removedUsers++;
  }
  return { ok: true, removedUsers };
}
