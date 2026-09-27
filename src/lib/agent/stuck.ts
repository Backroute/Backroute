import "server-only";
import type { GaveUp } from "../channels/out";
import type { Escalation } from "../types";
import type { Item } from "../cloud/rows";
import { admin, claimMark, loadContext, save } from "./db";
import { passToOwner } from "./dispatcher";
import { alertSupport } from "./support";

/**
 * Work that got stuck, found on the dispatcher's rounds and put in front of a person:
 * - a text or email that still couldn't go out after the provider was down for its whole window;
 * - an urgent item with support that nobody has taken after 15 minutes: the team is texted again, once;
 * - an urgent item with the owner (a driver who won't answer on a late load) that they haven't touched in an hour:
 *   support takes it, since someone has to.
 */
export async function flagStuck(gaveUp: GaveUp[], now = Date.now()): Promise<string[]> {
  const done: string[] = [];
  for (const g of gaveUp) {
    const ctx = await loadContext(g.carrierId);
    if (!ctx) continue;
    const what = g.channel === "sms" ? `A text to ${g.recipient}` : `An email to ${g.recipient}${g.subject ? ` ("${g.subject}")` : ""}`;
    await passToOwner(ctx, { reason: `${what} couldn't be delivered: the ${g.channel === "sms" ? "text" : "email"} service was down the whole time it was worth sending. It said: "${(g.body ?? "").slice(0, 300)}". Reach them another way.`, label: "Reached them", source: g.channel === "sms" ? "sms" : "email", to: "support" });
    done.push(`${g.carrierId}: ${what} not delivered, support told`);
  }

  const since = new Date(now - 15 * 60_000).toISOString();
  const { data } = await admin().from("escalations").select("carrier_id, data").eq("status", "with_support").lt("updated_at", since).limit(200);
  for (const row of data ?? []) {
    const e = row.data as Escalation;
    if (e.complexity !== "critical" || e.supportAssignee || Date.parse(e.createdAt) > now - 15 * 60_000) continue;
    if (!(await claimMark(row.carrier_id as string, `esc:${e.id}`, "stuck_alert"))) continue;
    const ctx = await loadContext(row.carrier_id as string);
    await alertSupport(ctx?.carrier ?? null, `Still waiting after ${Math.round((now - Date.parse(e.createdAt)) / 60000)} min, nobody has it: ${ctx?.carrier.name ?? "a carrier"}. ${e.reason}`.slice(0, 600)).catch(() => {});
    done.push(`${ctx?.carrier.name ?? row.carrier_id}: urgent item unclaimed, support texted again`);
  }
  const hour = new Date(now - 60 * 60_000).toISOString();
  const { data: open } = await admin().from("escalations").select("carrier_id, data").eq("status", "open").lt("updated_at", hour).limit(200);
  for (const row of open ?? []) {
    const e = row.data as Escalation;
    if (e.complexity !== "critical" || Date.parse(e.createdAt) > now - 60 * 60_000 || Date.parse(e.createdAt) < now - 24 * 60 * 60_000) continue;
    if (!(await claimMark(row.carrier_id as string, `esc:${e.id}`, "owner_silent"))) continue;
    const ctx = await loadContext(row.carrier_id as string);
    if (!ctx) continue;
    const moved: Escalation = { ...e, status: "with_support", reason: `${e.reason} (The owner hasn't picked this up in ${Math.round((now - Date.parse(e.createdAt)) / 60000)} minutes.)` };
    await save("escalations", ctx.carrier.id, moved as unknown as Item);
    await alertSupport(ctx.carrier, `Backroute support, urgent: ${ctx.carrier.name}. ${moved.reason}`.slice(0, 600)).catch(() => {});
    done.push(`${ctx.carrier.name}: urgent item the owner didn't pick up, support has it`);
  }
  return done;
}
