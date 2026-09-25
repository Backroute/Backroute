import { loadContext, logChannel } from "@/lib/agent/db";
import { nextShop, shopCallTurn } from "@/lib/agent/roadside";
import { publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 30;

/** What the repair shop said: yes (the driver gets their number), no (the AI calls the next one), or unclear. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/shop/turn");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const carrierId = url.searchParams.get("carrier") ?? "";
  const missed = Number(url.searchParams.get("missed") ?? 0);
  const ctx = await loadContext(carrierId);
  const truck = ctx?.trucks.find((t) => t.id === url.searchParams.get("truck"));
  if (!ctx || !truck?.roadside) return twiml("<Hangup/>");
  const turnUrl = publicUrl(request, `/api/channels/voice/shop/turn?carrier=${encodeURIComponent(carrierId)}&truck=${encodeURIComponent(truck.id)}`);
  const said = (params.SpeechResult ?? "").trim();
  const key = `shop:${params.CallSid}`;
  if (!said) {
    if (missed >= 1) {
      await nextShop(ctx, truck);
      return twiml(`${say("Sorry, I'll try someone else. Thanks.", "en")}<Hangup/>`);
    }
    return twiml(sayAndListen("Sorry, I didn't catch that. Can you help us today?", "en", `${turnUrl}&missed=1`));
  }
  await logChannel({ carrierId, channel: "voice", direction: "in", counterparty: key, body: said, data: { kind: "shop_call", truckId: truck.id } });
  const result = await shopCallTurn(ctx, truck, said);
  await logChannel({ carrierId, channel: "voice", direction: "out", counterparty: key, body: result.reply, data: { kind: "shop_call", truckId: truck.id } });
  return result.hangUp ? twiml(`${say(result.reply, "en")}<Hangup/>`) : twiml(sayAndListen(result.reply, "en", `${turnUrl}&missed=${missed}`));
}
