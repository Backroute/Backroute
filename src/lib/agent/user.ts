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
