import { aiConfigured } from "@/lib/ai/server";
import { loadContext, logChannel, threadWith } from "@/lib/agent/db";
import { brokerCallKey, brokerCallTurn } from "@/lib/agent/broker-call";
import { passToOwner } from "@/lib/agent/dispatcher";
import { publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 30;

const SORRY = "Sorry, I'll have someone from the office follow up by email. Thanks.";

/** What the broker just said on the call; the AI answers inside the carrier's rules and listens again. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/broker/turn");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const carrierId = url.searchParams.get("carrier") ?? "";
  const missed = Number(url.searchParams.get("missed") ?? 0);
  const ctx = await loadContext(carrierId);
  const load = ctx?.loads.find((l) => l.id === url.searchParams.get("load"));
  if (!ctx || !load) return twiml("<Hangup/>");
  const turnUrl = publicUrl(request, `/api/channels/voice/broker/turn?carrier=${encodeURIComponent(carrierId)}&load=${encodeURIComponent(load.id)}`);
  const said = (params.SpeechResult ?? "").trim();
  if (!said) return missed >= 1 ? twiml(`${say("I'll follow up by email. Thanks.", "en")}<Hangup/>`) : twiml(sayAndListen("Sorry, I didn't catch that.", "en", `${turnUrl}&missed=1`));

  const key = brokerCallKey(params.CallSid);
  const earlier = await threadWith(carrierId, "voice", key, 16);
  await logChannel({ carrierId, channel: "voice", direction: "in", counterparty: key, body: said, data: { kind: "broker_call", loadId: load.id, confidence: params.Confidence } });
  const history = earlier.map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
  const result = aiConfigured() ? await brokerCallTurn(ctx, load, said, history) : { reply: "", hangUp: true, failed: true };
  if (result.failed) {
    await passToOwner(ctx, { reason: `The AI's call with the broker about ${load.referenceNumber} broke off after they said: "${said}". Follow up with them.`, loadId: load.id, label: "Followed up", source: "voice", to: "support" });
    await logChannel({ carrierId, channel: "voice", direction: "out", counterparty: key, body: SORRY, data: { kind: "broker_call", loadId: load.id } });
    return twiml(`${say(SORRY, "en")}<Hangup/>`);
  }
  await logChannel({ carrierId, channel: "voice", direction: "out", counterparty: key, body: result.reply, data: { kind: "broker_call", loadId: load.id } });
  return result.hangUp ? twiml(`${say(result.reply, "en")}<Hangup/>`) : twiml(sayAndListen(result.reply, "en", turnUrl));
}
