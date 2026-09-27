import { readTwilioWebhook, twiml, twilioConfigured } from "@/lib/channels/twilio";
import { takeMessage } from "@/lib/channels/voice";

export const maxDuration = 30;

/** A caller the dispatch line doesn't know said who they are and what they need: it goes to support. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/message");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  return takeMessage(params);
}
