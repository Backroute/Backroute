import { readTwilioWebhook, twiml, twilioConfigured } from "@/lib/channels/twilio";
import { nextTurn } from "@/lib/channels/voice";

// Twilio waits up to 15 seconds for each answer; the AI answers calls at low effort to stay well inside that.
export const maxDuration = 30;

/** What the driver just said on the call; the answer is spoken back and the line listens again. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/turn");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  return nextTurn(request, params, Number(new URL(request.url).searchParams.get("missed") ?? 0));
}
