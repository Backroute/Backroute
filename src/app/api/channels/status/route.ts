import { aiConfigured } from "@/lib/ai/server";
import { dbConfigured } from "@/lib/agent/db";
import { asUser } from "@/lib/agent/user";
import { emailConfigured, inboundAddress } from "@/lib/channels/email";
import { twilioConfigured } from "@/lib/channels/twilio";

/**
 * Which real channels are switched on, the carrier's own inbound email address, the latest texts, calls and emails,
 * and what didn't go straight out: held in practice mode, waiting to be sent again, or given up on.
 */
export async function GET(request: Request) {
  const user = asUser(request);
  const channels = {
    ai: aiConfigured(),
    server: dbConfigured(),
    sms: twilioConfigured(),
    voice: twilioConfigured(),
    email: emailConfigured() && Boolean(process.env.EMAIL_WEBHOOK_TOKEN),
    dailyText: Boolean(process.env.CRON_SECRET) && twilioConfigured(),
    number: process.env.TWILIO_FROM_NUMBER ?? null,
  };
  if (!user) return Response.json({ channels });
  const carrierId = new URL(request.url).searchParams.get("carrier");
  const [{ data: carrier }, { data: log }, { data: outbound }] = await Promise.all([
    carrierId ? user.from("carriers").select("inbound_key").eq("id", carrierId).maybeSingle() : Promise.resolve({ data: null }),
    user.from("channel_messages").select("channel, direction, counterparty, body, created_at, data, provider_id").order("created_at", { ascending: false }).limit(25),
    user.from("outbound").select("channel, recipient, subject, body, status, data, created_at").in("status", ["held", "retry", "gave_up"]).order("created_at", { ascending: false }).limit(40),
  ]);
  const key = (carrier as { inbound_key?: string } | null)?.inbound_key;
  return Response.json({ channels, inboundEmail: key ? inboundAddress(key) : null, log: log ?? [], outbound: outbound ?? [] });
}
