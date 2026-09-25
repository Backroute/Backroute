import { after } from "next/server";
import { timingSafeEqual } from "crypto";
import { carrierByInboundKey, dbConfigured, logChannel } from "@/lib/agent/db";
import { handleInboundEmail } from "@/lib/agent/email";
import { plainText, type InboundEmail } from "@/lib/channels/email";

export const maxDuration = 120;

function tokenOk(given: string | null) {
  const expected = process.env.EMAIL_WEBHOOK_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Postmark's inbound webhook: an email to a carrier's Backroute address. Answered at once; handled right after. */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ ok: false, reason: "not_set_up" });
  if (!tokenOk(new URL(request.url).searchParams.get("token"))) return new Response("Forbidden", { status: 403 });
  const email = (await request.json().catch(() => null)) as InboundEmail | null;
  if (!email?.MessageID) return new Response("Bad request", { status: 400 });

  const key = email.MailboxHash || email.To.match(/\+([a-z0-9]+)@/i)?.[1];
  const carrier = key ? await carrierByInboundKey(key.toLowerCase()) : null;
  if (!carrier) return Response.json({ ok: true, ignored: "no_carrier" });

  const from = (email.FromFull?.Email ?? email.From).toLowerCase();
  const fresh = await logChannel({
    carrierId: carrier.id,
    channel: "email",
    direction: "in",
    providerId: email.MessageID,
    counterparty: from,
    body: plainText(email),
    data: { subject: email.Subject, fromName: email.FromName, attachments: (email.Attachments ?? []).map((a) => a.Name) },
  });
  if (fresh) after(() => handleInboundEmail(carrier.id, email));
  return Response.json({ ok: true });
}
