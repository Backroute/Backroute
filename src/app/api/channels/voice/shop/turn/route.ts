import { loadContext } from "@/lib/agent/db";
import { nextShop, shopCallReply } from "@/lib/agent/roadside";
import { MAX_HOLDS } from "@/lib/channels/ivr";
import { listen, press, publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

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
  const hold = Number(url.searchParams.get("hold") ?? 0);
  const said = (params.SpeechResult ?? "").trim();
  if (!said) {
    if (hold > 0 && hold < MAX_HOLDS) return twiml(listen("en", `${turnUrl}&hold=${hold + 1}`));
    if (missed >= 1 || hold >= MAX_HOLDS) {
      await nextShop(ctx, truck);
      return twiml(`${say("Sorry, I'll try someone else. Thanks.", "en")}<Hangup/>`);
    }
    return twiml(sayAndListen("Sorry, I didn't catch that. Can you help us today?", "en", `${turnUrl}&missed=1`));
  }
  const result = await shopCallReply(ctx, truck, params.CallSid, said);
  if (result.digits) return twiml(`${press(result.digits)}${listen("en", `${turnUrl}&hold=1`)}`);
  if (result.hold) return twiml(listen("en", `${turnUrl}&hold=${hold + 1}`));
  return result.hangUp ? twiml(`${result.reply ? say(result.reply, "en") : ""}<Hangup/>`) : twiml(sayAndListen(result.reply, "en", `${turnUrl}&missed=${missed}`));
}
