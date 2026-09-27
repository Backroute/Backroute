import { loadContext } from "@/lib/agent/db";
import { facilityCallReply, facilityMissed, type Stop } from "@/lib/agent/appointments";
import { MAX_HOLDS } from "@/lib/channels/ivr";
import { listen, press, publicUrl, readTwilioWebhook, say, sayAndListen, twiml, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 30;

/** What the scheduler said: a time (on the load, to the driver and broker), a question, or no. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/facility/turn");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const carrierId = url.searchParams.get("carrier") ?? "";
  const stop = url.searchParams.get("stop") as Stop;
  const missed = Number(url.searchParams.get("missed") ?? 0);
  const ctx = await loadContext(carrierId);
  const load = ctx?.loads.find((l) => l.id === url.searchParams.get("load"));
  if (!ctx || !load || (stop !== "pickup" && stop !== "delivery")) return twiml("<Hangup/>");
  const turnUrl = publicUrl(request, `/api/channels/voice/facility/turn?carrier=${encodeURIComponent(carrierId)}&load=${encodeURIComponent(load.id)}&stop=${stop}`);
  const hold = Number(url.searchParams.get("hold") ?? 0);
  const said = (params.SpeechResult ?? "").trim();
  if (!said) {
    if (hold > 0 && hold < MAX_HOLDS) return twiml(listen("en", `${turnUrl}&hold=${hold + 1}`));
    if (missed >= 1 || hold >= MAX_HOLDS) {
      await facilityMissed(ctx, load, stop);
      return twiml(`${say("Sorry, I'll call back a little later. Thanks.", "en")}<Hangup/>`);
    }
    return twiml(sayAndListen("Sorry, I didn't catch that. What time can you give us?", "en", `${turnUrl}&missed=1`));
  }
  const result = await facilityCallReply(ctx, load, stop, params.CallSid, said);
  if (result.digits) return twiml(`${press(result.digits)}${listen("en", `${turnUrl}&hold=1`)}`);
  if (result.hold) return twiml(listen("en", `${turnUrl}&hold=${hold + 1}`));
  return result.hangUp ? twiml(`${result.reply ? say(result.reply, "en") : ""}<Hangup/>`) : twiml(sayAndListen(result.reply, "en", `${turnUrl}&missed=${missed}`));
}
