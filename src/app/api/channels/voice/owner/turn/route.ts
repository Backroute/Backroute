import { readTwilioWebhook, twiml, twilioConfigured } from "@/lib/channels/twilio";
import { ownerNextTurn } from "@/lib/channels/voice";

export const maxDuration = 30;

/** What the owner just said on their call to the dispatch line; the answer is spoken back and the line listens again. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/owner/turn");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  return ownerNextTurn(request, params, Number(new URL(request.url).searchParams.get("missed") ?? 0));
}
