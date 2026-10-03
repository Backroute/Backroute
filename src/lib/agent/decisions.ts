import "server-only";
import type { Item } from "../cloud/rows";
import type { Escalation } from "../types";
import { save, type CarrierContext } from "./db";
import { noticeDecisions } from "./learning";
import { moveTruck } from "./reposition";

/**
 * The yes/no questions the AI acts on once the owner answers, from a tap in Needs you, the notification's button or
 * the app's chat: yes does it, no leaves it. Each is done once. A few yeses in a row, and the AI offers to stop asking.
 */
export async function actOnDecision(ctx: CarrierContext, e: Escalation): Promise<Escalation> {
  const d = e.decision;
  if (!d || d.doneAt || e.status !== "resolved") return e;
  let done = e;
  if (e.approved) {
    if (d.kind === "reposition") {
      const truck = ctx.trucks.find((t) => t.id === d.truckId);
      // Still empty and still where it was: send it. A load since then wins.
      const busy = !truck || truck.currentLoadId || ctx.loads.some((l) => l.truckId === d.truckId && ["negotiating", "booked", "rate_confirmed", "dispatched", "at_pickup", "in_transit", "at_delivery"].includes(l.stage));
      if (truck && !busy) await moveTruck(ctx, truck, d, `You said yes: truck ${truck.unitNumber} heads to ${d.city}, ${d.state}.`, Date.now());
      done = { ...e, decision: { ...d, doneAt: new Date().toISOString() }, resolutionNote: busy ? "The truck got a load first, so it stays." : `Sent toward ${d.city}, ${d.state}.` };
    }
  } else done = { ...e, decision: { ...d, doneAt: new Date().toISOString() } };
  await save("escalations", ctx.carrier.id, done as unknown as Item);
  ctx.escalations = ctx.escalations.map((x) => (x.id === done.id ? done : x));
  await noticeDecisions(ctx, done);
  return done;
}

/** Each round: answers given in the app (saved with the escalation) that haven't been acted on yet. */
export async function actOnDecisions(ctx: CarrierContext): Promise<string[]> {
  const out: string[] = [];
  for (const e of ctx.escalations.filter((x) => x.decision && !x.decision.doneAt && x.status === "resolved" && x.resolvedBy === "carrier")) {
    const done = await actOnDecision(ctx, e);
    if (done.decision?.doneAt) out.push(`Owner answered: ${done.resolutionNote ?? (done.approved ? "yes" : "no")}`);
  }
  return out;
}
