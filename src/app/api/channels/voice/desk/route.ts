import { readTwilioWebhook, twiml, twilioConfigured } from "@/lib/channels/twilio";
import { deskTurn } from "@/lib/channels/desk";

export const maxDuration = 30;

/** A turn at the dispatch line's front desk: a caller who isn't a driver, the owner, or a broker calling back. */
export async function POST(request: Request) {
  if (!twilioConfigured()) return twiml("<Hangup/>");
  const url = new URL(request.url);
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/voice/desk");
  if (!valid) return new Response("Invalid signature", { status: 403 });
  return deskTurn(request, params, url.searchParams.get("carrier"), Number(url.searchParams.get("missed") ?? 0));
}
