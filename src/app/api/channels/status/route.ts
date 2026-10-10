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
  const [{ data: carrier }, { data: log }, { data: outbound }, { data: setup }] = await Promise.all([
    carrierId ? user.from("carriers").select("inbound_key").eq("id", carrierId).maybeSingle() : Promise.resolve({ data: null }),
    user.from("channel_messages").select("channel, direction, counterparty, body, created_at, data, provider_id").order("created_at", { ascending: false }).limit(25),
    user.from("outbound").select("channel, recipient, subject, body, status, data, created_at").in("status", ["held", "retry", "gave_up"]).order("created_at", { ascending: false }).limit(40),
    // The email setup's own mail: the owner's test emails and Gmail's forwarding code (lib/agent/inbox).
    user.from("channel_messages").select("counterparty, data, created_at").eq("channel", "email").in("data->>kind", ["test", "forward_confirm"]).order("created_at", { ascending: false }).limit(6),
  ]);
  type SetupRow = { counterparty: string | null; created_at: string; data: { kind: string; via?: string; subject?: string; code?: string | null; link?: string | null } };
  const rows = (setup ?? []) as SetupRow[];
  const test = rows.find((r) => r.data.kind === "test");
  const confirm = rows.find((r) => r.data.kind === "forward_confirm");
  const key = (carrier as { inbound_key?: string } | null)?.inbound_key;
  return Response.json({
    channels,
    inboundEmail: key ? inboundAddress(key) : null,
    log: (log ?? []).filter((m) => !(m.data as { kind?: string } | null)?.kind),
    outbound: outbound ?? [],
    emailSetup: {
      lastTest: test ? { at: test.created_at, from: test.counterparty, via: test.data.via ?? "direct" } : null,
      gmailCode: confirm ? { at: confirm.created_at, code: confirm.data.code ?? null, link: confirm.data.link ?? null } : null,
    },
  });
}
