import { loadContext } from "@/lib/agent/db";
import { brokerCallReply, retryAfterVoicemail } from "@/lib/agent/broker-call";
import { MAX_HOLDS } from "@/lib/channels/ivr";
import { listen, press, publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 30;

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
  const hold = Number(url.searchParams.get("hold") ?? 0);
  const said = (params.SpeechResult ?? "").trim();
  if (!said) {
    // On hold (music isn't speech): keep waiting quietly, up to about ten minutes.
    if (hold > 0 && hold < MAX_HOLDS) return twiml(listen("en", `${turnUrl}&hold=${hold + 1}`));
    if (hold >= MAX_HOLDS) {
      await retryAfterVoicemail(ctx, load);
      return twiml("<Hangup/>");
    }
    return missed >= 1 ? twiml(`${say("I'll follow up by email. Thanks.", "en")}<Hangup/>`) : twiml(sayAndListen("Sorry, I didn't catch that.", "en", `${turnUrl}&missed=1`));
  }

  const result = await brokerCallReply(ctx, load, params.CallSid, said, { confidence: params.Confidence });
  if (result.digits) return twiml(`${press(result.digits)}${listen("en", `${turnUrl}&hold=1`)}`);
  if (result.hold) return twiml(listen("en", `${turnUrl}&hold=${hold + 1}`));
  return result.hangUp ? twiml(`${result.reply ? say(result.reply, "en") : ""}<Hangup/>`) : twiml(sayAndListen(result.reply, "en", turnUrl));
}
