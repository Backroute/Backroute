import { z } from "zod";
import { addActivity, carrierById, dbConfigured, logChannel, save } from "@/lib/agent/db";
import { event } from "@/lib/agent/dispatcher";
import { asUser } from "@/lib/agent/user";
import { emailConfigured, sendEmail } from "@/lib/channels/email";
import type { Item } from "@/lib/cloud/rows";
import type { Escalation } from "@/lib/types";

const Body = z.object({ escalationId: z.string().min(1), send: z.boolean(), body: z.string().trim().min(1).max(20000).optional() });

/**
 * The owner's answer to a message the AI wrote: send it (as written or edited) or don't. Only the office of the
 * carrier the draft belongs to can see it, and so only they can send it.
 */
export async function POST(request: Request) {
  const user = asUser(request);
  if (!user || !dbConfigured()) return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  // Read as the person asking: the access rules only show escalations to their own carrier's office.
  const { data: row } = await user.from("escalations").select("carrier_id, data").eq("id", parsed.data.escalationId).maybeSingle();
  if (!row) return Response.json({ error: "not_found" }, { status: 404 });
  const carrierId = row.carrier_id as string;
  const escalation = row.data as Escalation;
  if (!escalation.draft || escalation.status === "resolved") return Response.json({ error: "nothing_to_send" }, { status: 409 });

  const body = parsed.data.body ?? escalation.draft.body;
  const now = new Date().toISOString();
  if (parsed.data.send) {
    if (!emailConfigured()) return Response.json({ error: "email_off" }, { status: 503 });
    const carrier = await carrierById(carrierId);
    const draft = escalation.draft;
    const id = await sendEmail({ to: draft.to, subject: draft.subject ?? "", text: body, fromName: carrier?.name ?? "Dispatch", inReplyTo: draft.inReplyTo });
    await logChannel({ carrierId, channel: "email", direction: "out", providerId: id ?? null, counterparty: draft.to.toLowerCase(), body, data: { subject: draft.subject, approved: true } });
    await addActivity(carrierId, event({ type: "negotiation_email", loadId: escalation.loadId || undefined, message: `Sent the AI's reply to ${draft.toName ?? draft.to}`, detail: draft.subject ?? "", severity: "success" }));
  }
  const updated: Escalation = {
    ...escalation,
    status: "resolved",
    resolvedBy: "carrier",
    resolvedAt: now,
    draft: { ...escalation.draft, body, ...(parsed.data.send ? { sentAt: now } : {}) },
    ...(parsed.data.send ? {} : { resolutionNote: "Not sent" }),
  };
  await save("escalations", carrierId, updated as unknown as Item);
  return Response.json({ escalation: updated });
}
