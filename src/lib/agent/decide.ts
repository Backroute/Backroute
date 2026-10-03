import "server-only";
import type { Item } from "../cloud/rows";
import type { Escalation } from "../types";
import { save, type CarrierContext } from "./db";
import { noticeApprovals } from "./learning";
import { actOnDecision } from "./decisions";
import { deliver } from "./outbox";

/**
 * The owner's answer to something waiting on them. A message the AI wrote goes out (as written or edited) or doesn't;
 * anything else is marked handled. The same from a tap in Needs you and from telling the AI in the app's chat.
 */
export async function decideItem(ctx: CarrierContext, escalation: Escalation, send: boolean, body?: string): Promise<Escalation> {
  const now = new Date().toISOString();
  if (!escalation.draft) {
    let done: Escalation = { ...escalation, status: "resolved", resolvedBy: "carrier", resolvedAt: now, resolutionNote: send ? "Done" : "Dismissed", approved: send };
    await save("escalations", ctx.carrier.id, done as unknown as Item);
    ctx.escalations = ctx.escalations.map((e) => (e.id === done.id ? done : e));
    // A yes/no the AI acts on (move an empty truck): yes does it now.
    if (done.decision) done = await actOnDecision(ctx, done);
    return done;
  }
  const text = body ?? escalation.draft.body;
  if (send) await deliver(ctx, { ...escalation.draft, body: text }, escalation.loadId || undefined, { approved: true });
  const updated: Escalation = {
    ...escalation,
    status: "resolved",
    resolvedBy: "carrier",
    resolvedAt: now,
    draft: { ...escalation.draft, body: text, edited: text.trim() !== escalation.draft.body.trim(), ...(send ? { sentAt: now } : {}) },
    ...(send ? {} : { resolutionNote: "Not sent" }),
  };
  await save("escalations", ctx.carrier.id, updated as unknown as Item);
  ctx.escalations = ctx.escalations.map((e) => (e.id === updated.id ? updated : e));
  await noticeApprovals(ctx, updated);
  return updated;
}
