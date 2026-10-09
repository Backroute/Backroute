import { z } from "zod";
import { readTwilioWebhook, twiml, twilioConfigured } from "@/lib/channels/twilio";
import { updateCall } from "@/lib/channels/voice";

export const maxDuration = 30;

const Kind = z.enum(["next_load", "cancelled", "appointment"]);

/** The driver (or their voicemail) picked up a call the AI placed about a change: a new load, a cancellation, a moved appointment. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/update");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const kind = Kind.safeParse(url.searchParams.get("kind"));
  const loadId = url.searchParams.get("load");
  if (!kind.success || !loadId) return twiml("<Hangup/>");
  return updateCall(request, params, loadId, kind.data);
}
