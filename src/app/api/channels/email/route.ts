import { after } from "next/server";
import { timingSafeEqual } from "crypto";
import { carrierByInboundKey, dbConfigured } from "@/lib/agent/db";
import { takeEmail, viaOf } from "@/lib/agent/inbox";
import { handleInboundEmail } from "@/lib/agent/email";
import { historyFromEmail, parseHistoryHash } from "@/lib/agent/history-docs";
import type { InboundEmail } from "@/lib/channels/email";

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

  const hash = (email.MailboxHash || email.To.match(/\+([a-z0-9-]+)@/i)?.[1] || "").toLowerCase();
  // "<key>-h<token>": old rate cons the owner forwards to build their history (lib/agent/history-docs).
  const history = parseHistoryHash(hash);
  const key = history ? history[1] : hash;
  const carrier = key ? await carrierByInboundKey(key) : null;
  if (!carrier) return Response.json({ ok: true, ignored: "no_carrier" });
  if (history) {
    after(() => historyFromEmail(carrier.id, email, history[2]).then(() => undefined).catch((e) => console.error("[email] history import failed", e)));
    return Response.json({ ok: true, history: true });
  }

  const domain = process.env.EMAIL_INBOUND_ADDRESS?.split("@")[1] ?? null;
  const taken = await takeEmail(carrier.id, email, email.MessageID, viaOf(email, domain));
  if (taken === "handle") after(() => handleInboundEmail(carrier.id, email));
  return Response.json({ ok: true });
}
