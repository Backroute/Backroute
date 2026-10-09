import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Keeps a count of the errors the app hits (app_errors), for the System tab and the alerts. Used by
 * instrumentation.ts, which runs outside the server components layer and so can't use lib/agent/db (it's marked
 * server-only); this has its own service client, and the service key never reaches a browser bundle.
 */

let client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export interface AppError {
  source: "server" | "browser";
  message: string;
  /** The page or API path, without its query (which can carry tokens). */
  path?: string | null;
  digest?: string | null;
  stack?: string | null;
}

/** Ids, numbers and hex in a message vary between occurrences of the same error; they're left out of its identity. */
export const errorKind = (message: string) =>
  message
    .split("\n")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    // Anything with a digit in it: an id like load-mv13c2 (6 or more characters), or a number.
    .replace(/[\w-]*\d[\w-]*/g, (t) => (t.length >= 6 ? "<id>" : "#"))
    .slice(0, 200);

/** The path's shape: "/carrier/loads/load-abc123" and "/carrier/loads/load-xyz" are the same page. */
export const pathKind = (path: string) =>
  path
    .split("?")[0]
    .split("/")
    .map((seg) => (/\d/.test(seg) && seg.length > 6 ? ":id" : seg))
    .join("/")
    .slice(0, 200);

export function fingerprint(e: AppError, day = new Date().toISOString().slice(0, 10)): string {
  return `${day}:${createHash("sha256").update(`${e.source}|${pathKind(e.path ?? "")}|${errorKind(e.message)}`).digest("hex").slice(0, 24)}`;
}

/** Counts the error. Never throws: reporting an error mustn't cause another. */
export async function recordError(e: AppError): Promise<void> {
  const d = db();
  if (!d || !e.message) return;
  try {
    const { error } = await d.rpc("note_error", {
      p_fingerprint: fingerprint(e),
      p_source: e.source,
      p_path: e.path ? e.path.split("?")[0] : null,
      p_message: e.message,
      p_digest: e.digest ?? null,
      p_stack: e.stack ?? null,
    });
    if (error) console.error("[errors] couldn't record", error.message);
  } catch (err) {
    console.error("[errors] couldn't record", err);
  }
}
