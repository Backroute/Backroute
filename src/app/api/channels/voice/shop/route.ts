import { loadContext, logChannel } from "@/lib/agent/db";
import { nextShop, SHOP_VOICEMAIL, shopCallOpening } from "@/lib/agent/roadside";
import { publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 30;

/** A repair shop picked up the AI's call about a broken-down truck (or their voicemail did). */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/shop");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const carrierId = url.searchParams.get("carrier") ?? "";
  const ctx = await loadContext(carrierId);
  const truck = ctx?.trucks.find((t) => t.id === url.searchParams.get("truck"));
  if (!ctx || !truck?.roadside || truck.roadside.found) return twiml("<Hangup/>");
  const key = `shop:${params.CallSid}`;
  if ((params.AnsweredBy ?? "").startsWith("machine")) {
    const vm = SHOP_VOICEMAIL(ctx);
    await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:voicemail`, counterparty: key, body: vm, data: { kind: "shop_call", truckId: truck.id, voicemail: true } });
    await nextShop(ctx, truck);
    return twiml(`${say(vm, "en")}<Hangup/>`);
  }
  const opening = shopCallOpening(ctx, truck, truck.roadside);
  await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, counterparty: key, body: opening, data: { kind: "shop_call", truckId: truck.id } });
  return twiml(sayAndListen(opening, "en", publicUrl(request, `/api/channels/voice/shop/turn?carrier=${encodeURIComponent(carrierId)}&truck=${encodeURIComponent(truck.id)}`)));
}
