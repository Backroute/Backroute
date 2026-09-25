import { z } from "zod";
import { addActivity, dbConfigured, loadContext, logChannel, save, saveDriverMessage } from "@/lib/agent/db";
import { event, uid } from "@/lib/agent/dispatcher";
import { deliver } from "@/lib/agent/outbox";
import { supportCaller } from "@/lib/agent/support";
import { emailConfigured } from "@/lib/channels/email";
import { sendSms, twilioConfigured } from "@/lib/channels/twilio";
import { toE164 } from "@/lib/cloud/phone";
import type { Item } from "@/lib/cloud/rows";
import type { Escalation } from "@/lib/types";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("take"), carrierId: z.string(), escalationId: z.string() }),
  z.object({ action: z.literal("resolve"), carrierId: z.string(), escalationId: z.string(), note: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("to_owner"), carrierId: z.string(), escalationId: z.string(), note: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("send_draft"), carrierId: z.string(), escalationId: z.string(), body: z.string().trim().min(1).max(20000) }),
  z.object({ action: z.literal("text_driver"), carrierId: z.string(), driverId: z.string(), body: z.string().trim().min(1).max(1500), escalationId: z.string().optional() }),
  z.object({ action: z.literal("trust_broker"), carrierId: z.string(), escalationId: z.string(), brokerId: z.string(), note: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("text_owner"), carrierId: z.string(), body: z.string().trim().min(1).max(1500), escalationId: z.string().optional() }),
]);

/**
 * What a person on Backroute's support team does about something the AI handed them: take it, text the driver or the
 * owner from the dispatch number, send (or fix and send) what the AI drafted, give it back to the owner, or close it
 * with a note the owner sees. Every action is checked against the support team list and logged.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const me = await supportCaller(request);
  if (!me) return Response.json({ error: "support_only" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const a = parsed.data;
  const ctx = await loadContext(a.carrierId);
  if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });
  const esc = "escalationId" in a && a.escalationId ? ctx.escalations.find((e) => e.id === a.escalationId) : undefined;
  if ("escalationId" in a && a.escalationId && !esc) return Response.json({ error: "not_found" }, { status: 404 });
  const at = new Date().toISOString();
  const update = async (patch: Partial<Escalation>) => {
    const next = { ...esc!, ...patch };
    await save("escalations", ctx.carrier.id, next as unknown as Item);
    return next;
  };

  switch (a.action) {
    case "take":
      return Response.json({ escalation: await update({ supportAssignee: me.name }) });
    case "resolve": {
      const done = await update({ status: "resolved", resolvedBy: "support", resolvedAt: at, resolutionNote: a.note, supportAssignee: esc!.supportAssignee ?? me.name });
      await addActivity(ctx.carrier.id, event({ type: "escalation", loadId: esc!.loadId || undefined, message: "Backroute support handled it", detail: a.note, severity: "success" }));
      return Response.json({ escalation: done });
    }
    case "to_owner": {
      const back = await update({ status: "open", reason: `${esc!.reason}\n\nBackroute support: ${a.note}` });
      return Response.json({ escalation: back });
    }
    case "send_draft": {
      if (!esc!.draft) return Response.json({ error: "nothing_to_send" }, { status: 409 });
      if (!emailConfigured()) return Response.json({ error: "email_off" }, { status: 503 });
      await deliver(ctx, { ...esc!.draft, body: a.body }, esc!.loadId || undefined, { approved: true });
      const done = await update({ status: "resolved", resolvedBy: "support", resolvedAt: at, draft: { ...esc!.draft, body: a.body, sentAt: at }, resolutionNote: `Sent by ${me.name}` });
      return Response.json({ escalation: done });
    }
    case "text_driver": {
      const driver = ctx.drivers.find((d) => d.id === a.driverId);
      const to = driver ? toE164(driver.phone) : null;
      if (!driver || !to) return Response.json({ error: "not_found" }, { status: 404 });
      if (driver.prefs?.smsOptOut) return Response.json({ error: "opted_out" }, { status: 409 });
      if (!twilioConfigured()) return Response.json({ error: "sms_off" }, { status: 503 });
      const sid = await sendSms(to, a.body);
      await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: a.body, timestamp: at, channel: "sms", bySupport: me.name });
      await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: a.body, data: { bySupport: me.name } });
      return Response.json({ sent: true });
    }
    case "trust_broker": {
      // Support checked the broker by hand: marked verified on the broker itself, so the AI may book with them.
      const broker = ctx.brokers.find((b) => b.id === a.brokerId);
      if (!broker) return Response.json({ error: "not_found" }, { status: 404 });
      await save("records", ctx.carrier.id, { ...broker, authorityVerified: true, fraudRisk: "low", verifiedAt: at, verifyNote: `Checked by Backroute support (${me.name}): ${a.note}` } as unknown as Item, "broker");
      const done = await update({ status: "resolved", resolvedBy: "support", resolvedAt: at, resolutionNote: a.note, supportAssignee: esc!.supportAssignee ?? me.name });
      await addActivity(ctx.carrier.id, event({ type: "escalation", message: `Backroute support checked ${broker.company}`, detail: a.note, severity: "success" }));
      return Response.json({ escalation: done });
    }
    case "text_owner": {
      const to = ctx.carrier.owner_phone ? toE164(ctx.carrier.owner_phone) : null;
      if (!to) return Response.json({ error: "no_owner_phone" }, { status: 404 });
      if (!twilioConfigured()) return Response.json({ error: "sms_off" }, { status: 503 });
      const body = `Backroute support: ${a.body}`;
      const sid = await sendSms(to, body);
      await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: to, body, data: { bySupport: me.name, kind: "support_to_owner" } });
      return Response.json({ sent: true });
    }
  }
}
