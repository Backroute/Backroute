import { aiConfigured } from "@/lib/ai/server";
import { dbConfigured } from "@/lib/agent/db";
import { asUser } from "@/lib/agent/user";
import { emailConfigured, inboundAddress } from "@/lib/channels/email";
import { twilioConfigured } from "@/lib/channels/twilio";

/** Which real channels are switched on, the carrier's own inbound email address, and the latest texts, calls and emails. */
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
  const [{ data: carrier }, { data: log }] = await Promise.all([
    carrierId ? user.from("carriers").select("inbound_key").eq("id", carrierId).maybeSingle() : Promise.resolve({ data: null }),
    user.from("channel_messages").select("channel, direction, counterparty, body, created_at, data").order("created_at", { ascending: false }).limit(25),
  ]);
  const key = (carrier as { inbound_key?: string } | null)?.inbound_key;
  return Response.json({ channels, inboundEmail: key ? inboundAddress(key) : null, log: log ?? [] });
}
