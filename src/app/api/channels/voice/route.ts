import { dbConfigured } from "@/lib/agent/db";
import { readTwilioWebhook, say, twiml, twilioConfigured } from "@/lib/channels/twilio";
import { answerCall } from "@/lib/channels/voice";

export const maxDuration = 30;

/** A call to the dispatch number: the AI answers, says it's an AI, and listens. */
export async function POST(request: Request) {
  if (!twilioConfigured() || !dbConfigured()) return twiml(`${say("This line isn't set up yet. Please call your carrier.", "en")}<Hangup/>`);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  return answerCall(request, params);
}
