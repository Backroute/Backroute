import { z } from "zod";
import { dbConfigured, loadContext, logChannel, saveDriverMessage } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { canText, textTo } from "@/lib/channels/out";
import { toE164 } from "@/lib/cloud/phone";
import { textsHeld } from "@/lib/consent";
import type { DriverMessage } from "@/lib/types";

const Body = z.object({ id: z.string().min(3).max(80), driverId: z.string().min(1).max(80), body: z.string().trim().min(1).max(1500) });

/**
 * The owner (or a dispatcher) writing to one of their drivers from the app. It lands in the driver's Messages and
 * buzzes their phone; a driver without the app's notifications on gets it as a text from the dispatch number, with
 * the company's name on it so they know it's the office and not the AI.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  if (who.me.role !== "owner" && who.me.role !== "dispatcher") return Response.json({ error: "office_only" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const ctx = await loadContext(who.me.carrierId);
  const driver = ctx?.drivers.find((d) => d.id === parsed.data.driverId);
  if (!ctx || !driver) return Response.json({ error: "not_found" }, { status: 404 });

  const message: DriverMessage = { id: parsed.data.id, driverId: driver.id, from: "owner", content: parsed.data.body, timestamp: new Date().toISOString(), byOwner: who.me.role === "owner" ? "the owner" : "dispatch" };
  const pushed = await saveDriverMessage(ctx.carrier.id, message);
  if (pushed) return Response.json({ sent: "app" });

  const to = toE164(driver.phone);
  if (!to || driver.prefs?.smsOptOut || !canText(ctx.carrier)) return Response.json({ sent: "app" });
  const held = await textsHeld(ctx.carrier.id, driver.id);
  const text = `${ctx.carrier.name}: ${message.content}`;
  const sid = await textTo(ctx.carrier, to, text);
  await saveDriverMessage(ctx.carrier.id, { ...message, channel: "sms" });
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind: "owner_to_driver" } });
  // Waiting on the driver's yes to texts: it's in their app, and the text goes once they say it.
  return Response.json({ sent: held ? "held" : "sms" });
}
