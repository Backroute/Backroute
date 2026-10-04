import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A database client acting as the signed-in person, so the access rules decide what they can see. Used to check
 * that someone may approve a draft before the server acts on it with its own key.
 */
export function asUser(request: Request): SupabaseClient | null {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return null;
  return createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}

interface Caller {
  userId: string;
  carrierId: string;
  role: "owner" | "dispatcher" | "driver" | "bookkeeper";
  driverId: string | null;
}

/**
 * Who is calling, and as whom, checked against the database as that person. Someone in more than one carrier is
 * taken in the one their app says they're working in (x-carrier-id), if they belong to it; otherwise their first.
 */
export async function caller(request: Request): Promise<{ db: SupabaseClient; me: Caller } | null> {
  const db = asUser(request);
  if (!db) return null;
  const token = request.headers.get("authorization")!.replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return null;
  const { data } = await db.from("members").select("carrier_id, role, driver_id").eq("user_id", auth.user.id).order("created_at");
  const wanted = request.headers.get("x-carrier-id");
  const m = (data ?? []).find((r) => r.carrier_id === wanted) ?? data?.[0];
  if (!m) return null;
  return { db, me: { userId: auth.user.id, carrierId: m.carrier_id as string, role: m.role as Caller["role"], driverId: (m.driver_id as string | null) ?? null } };
}
