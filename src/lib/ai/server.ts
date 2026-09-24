import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

/**
 * The real AI (Claude), server side only: the API key never reaches a browser. Off unless ANTHROPIC_API_KEY is set,
 * and then the app falls back to its scripted replies.
 */
export const AI_MODEL = "claude-opus-5";
/** If a request is declined by a safety check, the API retries it on a fallback model inside the same call. */
export const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export type Access = { ok: true; who: "account" | "demo" } | { ok: false; status: number; error: string };

// Demo visitors, when the owner allows real AI in the demo: a few questions each per hour. In memory, so it's per
// server instance: good enough to stop casual overuse, not a hard spending cap.
const DEMO_LIMIT = 15;
const DEMO_WINDOW_MS = 60 * 60 * 1000;
const demoUse = new Map<string, number[]>();

/**
 * Who may spend AI: anyone signed in to a real account, and demo visitors only when AI_IN_DEMO=on (rate limited).
 * The signed-in check asks Supabase whether the token is real.
 */
export async function authorize(request: Request): Promise<Access> {
  if (!aiConfigured()) return { ok: false, status: 503, error: "ai_off" };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (token && url && anon) {
    const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(token);
    if (!error && data.user) return { ok: true, who: "account" };
  }
  if (process.env.AI_IN_DEMO !== "on") return { ok: false, status: 403, error: "demo_scripted" };
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (demoUse.get(ip) ?? []).filter((t) => now - t < DEMO_WINDOW_MS);
  if (recent.length >= DEMO_LIMIT) return { ok: false, status: 429, error: "demo_limit" };
  demoUse.set(ip, [...recent, now]);
  return { ok: true, who: "demo" };
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

/** "No real AI for you" is an expected answer (the app falls back to scripted replies), not an error, so it comes
 *  back as a normal response: browsers log failed statuses as errors in the console. */
export function deny(access: Exclude<Access, { ok: true }>) {
  return access.status === 401 ? json({ error: access.error }, 401) : json({ unavailable: access.error });
}
