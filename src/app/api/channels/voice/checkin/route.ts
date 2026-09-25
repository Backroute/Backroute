import { z } from "zod";
import { readTwilioWebhook, twiml, twilioConfigured } from "@/lib/channels/twilio";
import { checkinCall } from "@/lib/channels/voice";

export const maxDuration = 30;

const Kind = z.enum(["before_pickup", "pickup_late", "pickup_silent", "before_delivery", "delivery_late", "delivery_silent", "pod_needed", "pod_silent"]);

/** The driver picked up a check-in call the AI placed. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/checkin");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const kind = Kind.safeParse(url.searchParams.get("kind"));
  const loadId = url.searchParams.get("load");
  if (!kind.success || !loadId) return twiml("<Hangup/>");
  return checkinCall(request, params, loadId, kind.data);
}
