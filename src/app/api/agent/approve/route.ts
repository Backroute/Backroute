import { z } from "zod";
import { dbConfigured, loadContext, save } from "@/lib/agent/db";
import { deliver } from "@/lib/agent/outbox";
import { noticeApprovals } from "@/lib/agent/learning";
import { asUser } from "@/lib/agent/user";
import { emailConfigured } from "@/lib/channels/email";
import type { Item } from "@/lib/cloud/rows";
import type { Escalation, Load } from "@/lib/types";

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
  const edited = body.trim() !== escalation.draft.body.trim();
  const now = new Date().toISOString();
  let load: Load | undefined;
  let ctx: Awaited<ReturnType<typeof loadContext>> = null;
  if (parsed.data.send) {
    if (!emailConfigured()) return Response.json({ error: "email_off" }, { status: 503 });
    ctx = await loadContext(carrierId);
    if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });
    await deliver(ctx, { ...escalation.draft, body }, escalation.loadId || undefined, { approved: true });
    load = ctx.loads.find((l) => l.id === escalation.loadId);
  }
  const updated: Escalation = {
    ...escalation,
    status: "resolved",
    resolvedBy: "carrier",
    resolvedAt: now,
    draft: { ...escalation.draft, body, edited, ...(parsed.data.send ? { sentAt: now } : {}) },
    ...(parsed.data.send ? {} : { resolutionNote: "Not sent" }),
  };
  await save("escalations", carrierId, updated as unknown as Item);
  if (ctx) await noticeApprovals(ctx, updated);
  return Response.json({ escalation: updated, loads: load ? [load] : [] });
}
