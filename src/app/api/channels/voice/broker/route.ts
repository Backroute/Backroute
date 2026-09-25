import { loadContext, logChannel } from "@/lib/agent/db";
import { brokerCallKey, brokerCallOpening, VOICEMAIL } from "@/lib/agent/broker-call";
import { publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 30;

/** The broker picked up a call the AI placed about a load (or their voicemail did). */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/broker");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const carrierId = url.searchParams.get("carrier") ?? "";
  const ctx = await loadContext(carrierId);
  const load = ctx?.loads.find((l) => l.id === url.searchParams.get("load"));
  if (!ctx || !load) return twiml("<Hangup/>");
  const key = brokerCallKey(params.CallSid);
  if ((params.AnsweredBy ?? "").startsWith("machine")) {
    const vm = VOICEMAIL(ctx, load);
    await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:voicemail`, counterparty: key, body: vm, data: { kind: "broker_call", loadId: load.id, voicemail: true } });
    return twiml(`${say(vm, "en")}<Hangup/>`);
  }
  const opening = brokerCallOpening(ctx, load);
  await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, counterparty: key, body: opening, data: { kind: "broker_call", loadId: load.id } });
  return twiml(sayAndListen(opening, "en", publicUrl(request, `/api/channels/voice/broker/turn?carrier=${encodeURIComponent(carrierId)}&load=${encodeURIComponent(load.id)}`)));
}
