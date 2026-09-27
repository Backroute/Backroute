import { loadContext, logChannel } from "@/lib/agent/db";
import { FACILITY_VOICEMAIL, facilityMissed, facilityOpening, type Stop } from "@/lib/agent/appointments";
import { streamTwiml, realtimeFor } from "@/lib/channels/realtime";
import { publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 30;

/** A shipper or receiver picked up the AI's call about a dock appointment (or their voicemail did). */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/facility");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const carrierId = url.searchParams.get("carrier") ?? "";
  const stop = url.searchParams.get("stop") as Stop;
  const ctx = await loadContext(carrierId);
  const load = ctx?.loads.find((l) => l.id === url.searchParams.get("load"));
  if (!ctx || !load || (stop !== "pickup" && stop !== "delivery") || load.appointments?.[stop]?.status !== "calling") return twiml("<Hangup/>");
  const key = `facility:${params.CallSid}`;
  if ((params.AnsweredBy ?? "").startsWith("machine")) {
    const vm = FACILITY_VOICEMAIL(ctx, load);
    await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:voicemail`, counterparty: key, body: vm, data: { kind: "facility_call", loadId: load.id, stop, voicemail: true } });
    await facilityMissed(ctx, load, stop);
    return twiml(`${say(vm, "en")}<Hangup/>`);
  }
  const opening = facilityOpening(ctx, load, stop);
  await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, counterparty: key, body: opening, data: { kind: "facility_call", loadId: load.id, stop } });
  if (realtimeFor("en")) return streamTwiml({ kind: "facility", carrier: carrierId, ref: `${load.id}:${stop}`, callSid: params.CallSid, lang: "en", opening });
  return twiml(sayAndListen(opening, "en", publicUrl(request, `/api/channels/voice/facility/turn?carrier=${encodeURIComponent(carrierId)}&load=${encodeURIComponent(load.id)}&stop=${stop}`)));
}
