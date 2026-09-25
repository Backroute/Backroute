import "server-only";
import { createClient } from "@supabase/supabase-js";
import { sendSms, twilioConfigured } from "../channels/twilio";
import { admin, logChannel } from "./db";

/**
 * Backroute's support team: the people who take over when something is outside what the AI can handle, for every
 * carrier. Staff are listed in the support_staff table (added by hand, see DEPLOY.md), and every support action goes
 * through the server after it checks the person is on that list.
 */

export interface SupportPerson {
  userId: string;
  name: string;
}

/** The signed-in person making this request, if they're on Backroute's support team. */
export async function supportCaller(request: Request): Promise<SupportPerson | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data: auth } = await createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }).auth.getUser(token);
  if (!auth.user) return null;
  const { data } = await admin().from("support_staff").select("user_id, name").eq("user_id", auth.user.id).maybeSingle();
  return data ? { userId: data.user_id as string, name: data.name as string } : null;
}

/** The support team's phones (SUPPORT_PHONES, comma-separated), for urgent hand-offs. */
const phones = () =>
  (process.env.SUPPORT_PHONES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

/** Texts the support team about something urgent at a carrier. Quietly does nothing when no phones are set. */
export async function alertSupport(carrierId: string, text: string) {
  if (!twilioConfigured()) return;
  for (const to of phones()) {
    const sid = await sendSms(to, text);
    await logChannel({ carrierId, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: to, body: text, data: { kind: "support_alert" } }).catch(() => {});
  }
}
