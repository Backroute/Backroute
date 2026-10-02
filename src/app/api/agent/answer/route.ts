import { z } from "zod";
import { admin, dbConfigured, loadContext } from "@/lib/agent/db";
import { decideItem } from "@/lib/agent/decide";
import { readAnswerToken } from "@/lib/agent/answer-token";
import { canEmail } from "@/lib/channels/out";
import type { Escalation } from "@/lib/types";

const Body = z.object({ token: z.string().min(20).max(1000), answer: z.enum(["yes", "no"]) });

/**
 * Yes or No from a phone notification (public/sw.js): the signed token in the notification says which item, so the
 * phone doesn't need to be signed in at that moment. The same as tapping it in Needs you.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const who = readAnswerToken(parsed.data.token);
  if (!who) return Response.json({ error: "expired" }, { status: 401 });
  const { data: row } = await admin().from("escalations").select("data").eq("carrier_id", who.carrierId).eq("id", who.escalationId).maybeSingle();
  const escalation = row?.data as Escalation | undefined;
  if (!escalation) return Response.json({ error: "not_found" }, { status: 404 });
  if (escalation.status === "resolved") return Response.json({ ok: true, already: true, note: "Already handled." });
  const ctx = await loadContext(who.carrierId);
  if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });
  const yes = parsed.data.answer === "yes";
  if (yes && escalation.draft && !canEmail(ctx.carrier)) return Response.json({ error: "email_off" }, { status: 503 });
  await decideItem(ctx, escalation, yes);
  return Response.json({ ok: true, note: yes ? (escalation.draft ? "Sent." : "Done.") : escalation.draft ? "Not sent." : "Dismissed." });
}
