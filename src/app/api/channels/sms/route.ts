import { after } from "next/server";
import { dbConfigured } from "@/lib/agent/db";
import { receiveText } from "@/lib/channels/sms";
import { readTwilioWebhook, twiml, twilioConfigured, xml } from "@/lib/channels/twilio";

export const maxDuration = 60;

/**
 * A driver (or the owner) texted the dispatch number. Twilio gets an empty answer right away; the AI's reply goes
 * out as its own text a few seconds later, so a slow answer never makes Twilio retry.
 */
export async function POST(request: Request) {
  if (!twilioConfigured() || !dbConfigured()) return twiml();
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/sms");
  if (!valid) return new Response("Invalid signature", { status: 403 });

  const media = Array.from({ length: Math.min(Number(params.NumMedia ?? 0) || 0, 5) }, (_, i) => ({ url: params[`MediaUrl${i}`] ?? "" }));
  const { now, later } = await receiveText({ from: params.From ?? "", body: params.Body ?? "", messageSid: params.MessageSid ?? "", media });
  if (later) after(later);
  return twiml(now ? `<Message>${xml(now)}</Message>` : "");
}
