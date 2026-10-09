import { z } from "zod";
import { admin, dbConfigured, driverByPhone, loadContext, logChannel, ownerByPhone, save, type CarrierContext } from "@/lib/agent/db";
import { forCarrier } from "@/lib/agent/scope";
import { brokerCallOpening } from "@/lib/agent/broker-call";
import { decideItem } from "@/lib/agent/decide";
import { handleInboundEmail } from "@/lib/agent/email";
import { importHistory } from "@/lib/agent/history";
import { runRounds } from "@/lib/agent/rounds";
import type { Item } from "@/lib/cloud/rows";
import { plainText, type InboundEmail } from "@/lib/channels/email";
import { receiveText } from "@/lib/channels/sms";
import { callTurn } from "@/lib/channels/turn";
import { aiConfigured } from "@/lib/ai/server";
import { judge, playPartner } from "@/lib/ai/sim";
import { makeBroker, makeLoad, makeTruckAndDriver } from "@/lib/fleet";
import type { AgentSettings } from "@/lib/store";
import type { EquipmentType, RunType, Truck } from "@/lib/types";
import { hasBearer } from "@/lib/bearer";

export const maxDuration = 300;

/**
 * The simulated brokers and drivers (eval/sim.mjs) talk to the AI through here: the same code a real email, text or
 * call goes through, for a practice carrier the simulator made. Nothing it does can leave Backroute (the carrier is
 * in sandbox mode, so every reply is held for the simulator to read) or touch a real carrier: every action is only
 * for carriers whose id starts with "sim-" and that are in sandbox mode. Off unless EVAL_SECRET is set.
 */

const Fleet = z.object({
  driverName: z.string(),
  phone: z.string(),
  unitNumber: z.string(),
  equipment: z.enum(["Dry Van", "Reefer", "Flatbed", "Step Deck"]),
  homeCity: z.string(),
  homeState: z.string(),
  runType: z.enum(["local", "regional", "otr", "intown"]),
  currentCity: z.string().optional(),
  currentState: z.string().optional(),
  language: z.enum(["en", "es", "pa", "hi", "ru", "uk", "fr"]).optional(),
});
const LoadIn = z.object({
  unitNumber: z.string(),
  ref: z.string(),
  broker: z.string(),
  origin: z.tuple([z.string(), z.string()]),
  destination: z.tuple([z.string(), z.string()]),
  miles: z.number().optional(),
  rate: z.number(),
  stage: z.enum(["dispatched", "at_pickup", "in_transit", "at_delivery"]),
  pickupInHours: z.number(),
  deliveryInHours: z.number(),
});
const Line = z.object({ from: z.enum(["them", "ai"]), text: z.string().max(8000) });
const BrokerIn = z.object({ company: z.string(), email: z.string(), phone: z.string().optional(), contact: z.string().optional(), mc: z.string().optional(), verified: z.boolean().default(true), language: z.string().optional() });

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup"), name: z.string().default("Sim Freight LLC"), ownerPhone: z.string().optional(), settings: z.record(z.string(), z.unknown()).default({}), fleet: z.array(Fleet).min(1).max(20), brokers: z.array(BrokerIn).max(50).default([]), loads: z.array(LoadIn).max(20).default([]) }),
  z.object({ action: z.literal("opening"), carrier: z.string(), kind: z.literal("broker"), ref: z.string() }),
  z.object({ action: z.literal("email"), carrier: z.string(), from: z.string(), fromName: z.string().optional(), subject: z.string(), text: z.string(), messageId: z.string().optional(), inReplyTo: z.string().optional() }),
  z.object({ action: z.literal("text"), carrier: z.string(), from: z.string(), body: z.string() }),
  z.object({ action: z.literal("call"), carrier: z.string(), kind: z.enum(["driver", "broker", "shop", "owner", "facility"]), ref: z.string(), callSid: z.string(), said: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("rounds"), carrier: z.string(), at: z.string().optional() }),
  z.object({ action: z.literal("held"), carrier: z.string(), after: z.string().optional() }),
  z.object({ action: z.literal("state"), carrier: z.string() }),
  z.object({ action: z.literal("decide"), carrier: z.string(), escalationId: z.string(), send: z.boolean(), body: z.string().optional() }),
  z.object({ action: z.literal("teardown"), carrier: z.string() }),
  z.object({ action: z.literal("import"), carrier: z.string(), csv: z.string().max(5_000_000) }),
  z.object({
    action: z.literal("play"),
    partner: z.object({ role: z.enum(["broker", "driver", "owner", "shop", "facility"]), channel: z.enum(["email", "sms", "call"]), persona: z.string().max(3000), secret: z.string().max(3000), language: z.string().optional() }),
    transcript: z.array(Line).max(60),
  }),
  z.object({ action: z.literal("judge"), situation: z.string().max(3000), expectations: z.array(z.string().max(500)).max(20), transcript: z.array(Line).max(60), outcome: z.string().max(3000) }),
]);

const isSim = (id: string) => id.startsWith("sim-");

export async function POST(request: Request) {
  if (!hasBearer(request, process.env.EVAL_SECRET)) return new Response("Not found", { status: 404 });
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const a = parsed.data;

  if (a.action === "setup") return Response.json(await setup(a));
  // Playing the other side, and judging the conversation, need the AI; without it the simulator uses its scripts.
  if (a.action === "play") return aiConfigured() ? Response.json({ move: await playPartner(a.partner, a.transcript) }) : Response.json({ error: "ai_off" }, { status: 503 });
  if (a.action === "judge") return aiConfigured() ? Response.json({ verdict: await judge(a.situation, a.expectations, a.transcript, a.outcome) }) : Response.json({ error: "ai_off" }, { status: 503 });

  if (!isSim(a.carrier)) return Response.json({ error: "not_a_sim_carrier" }, { status: 403 });
  const ctx = await loadContext(a.carrier);
  if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });
  if (!ctx.settings.sandbox) return Response.json({ error: "not_in_sandbox" }, { status: 403 });

  return forCarrier(ctx.carrier.id, () => act(a, ctx));
}

async function act(a: Exclude<z.infer<typeof Body>, { action: "setup" | "play" | "judge" }>, ctx: CarrierContext): Promise<Response> {
  switch (a.action) {
    case "email": {
      const email: InboundEmail = {
        MessageID: a.messageId ?? `sim-${crypto.randomUUID()}`,
        From: a.from,
        FromName: a.fromName,
        FromFull: { Email: a.from, Name: a.fromName },
        To: `sim+${ctx.carrier.inbound_key}@inbound.sim`,
        MailboxHash: ctx.carrier.inbound_key,
        Subject: a.subject,
        TextBody: a.text,
        Headers: [{ Name: "Message-ID", Value: `<${crypto.randomUUID()}@sim>` }, ...(a.inReplyTo ? [{ Name: "In-Reply-To", Value: a.inReplyTo }] : [])],
        Attachments: [],
      };
      const fresh = await logChannel({ carrierId: ctx.carrier.id, channel: "email", direction: "in", providerId: email.MessageID, counterparty: a.from.toLowerCase(), body: plainText(email), data: { subject: a.subject, fromName: a.fromName, attachments: [] } });
      if (fresh) await handleInboundEmail(ctx.carrier.id, email);
      return Response.json({ ok: true });
    }
    case "text": {
      // The number must be this simulated carrier's driver or owner, so a simulated text can't reach a real fleet.
      const driver = await driverByPhone(a.from);
      const owner = driver ? null : await ownerByPhone(a.from);
      if ((driver?.carrierId ?? owner?.id) !== ctx.carrier.id) return Response.json({ error: "not_this_carriers_number" }, { status: 403 });
      const { now, later } = await receiveText({ from: a.from, body: a.body, messageSid: `sim-${crypto.randomUUID()}` });
      if (later) await later();
      return Response.json({ now: now ?? null });
    }
    case "call":
      return Response.json(await callTurn(ctx, a.kind, a.ref, a.callSid, a.said, { sim: true }));
    case "opening": {
      const load = ctx.loads.find((l) => l.id === a.ref);
      return load ? Response.json({ opening: brokerCallOpening(ctx, load) }) : Response.json({ error: "not_found" }, { status: 404 });
    }
    case "rounds":
      return Response.json({ done: await runRounds(ctx, a.at ? Date.parse(a.at) : Date.now(), null) });
    case "held": {
      let q = admin().from("outbound").select("id, channel, recipient, subject, body, data, created_at").eq("carrier_id", ctx.carrier.id).eq("status", "held");
      if (a.after) q = q.gt("created_at", a.after);
      const { data, error } = await q.order("created_at").limit(200);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ held: data ?? [] });
    }
    case "state":
      return Response.json({ carrier: { id: ctx.carrier.id, inboundKey: ctx.carrier.inbound_key }, settings: ctx.settings, loads: ctx.loads, escalations: ctx.escalations, brokers: ctx.brokers, trucks: ctx.trucks, drivers: ctx.drivers });
    case "decide": {
      const escalation = ctx.escalations.find((e) => e.id === a.escalationId);
      if (!escalation) return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json({ escalation: await decideItem(ctx, escalation, a.send, a.body) });
    }
    case "import":
      return Response.json(await importHistory(ctx, a.csv));
    case "teardown": {
      const { error } = await admin().from("carriers").delete().eq("id", ctx.carrier.id);
      return Response.json({ ok: !error });
    }
  }
}

/** A practice carrier: sandbox on, the fleet and brokers the scenario needs, and the owner's numbers. */
async function setup(a: Extract<z.infer<typeof Body>, { action: "setup" }>) {
  const id = `sim-${crypto.randomUUID().slice(0, 12)}`;
  const settings: Partial<AgentSettings> = { autonomy: "rules", minRpm: 2.5, rateFloorPct: 96, ownerLanguage: "en", dailyText: false, ...(a.settings as Partial<AgentSettings>), sandbox: true };
  const { data: row, error } = await admin()
    .from("carriers")
    .insert({ id, name: a.name, mc: "MC 900001", dot: "DOT 9000001", owner_operator: a.fleet.length === 1 && !!settings.ownerOperator, owner_phone: a.ownerPhone ? `1${a.ownerPhone.replace(/\D/g, "").slice(-10)}` : null, settings })
    .select("inbound_key")
    .single();
  if (error) return { error: error.message };
  const drivers = [];
  const trucks = new Map<string, Truck>();
  for (const f of a.fleet) {
    const { truck, driver } = makeTruckAndDriver({ ...f, equipment: f.equipment as EquipmentType, runType: f.runType as RunType });
    const t = { ...truck, currentCity: f.currentCity ?? truck.currentCity, currentState: f.currentState ?? truck.currentState };
    const d = { ...driver, prefs: { ...driver.prefs, language: f.language ?? "en" } };
    trucks.set(t.unitNumber, t);
    await save("trucks", id, t as unknown as Item);
    await save("drivers", id, d as unknown as Item);
    drivers.push({ id: d.id, name: d.name, phone: d.phone, truckId: t.id, unitNumber: t.unitNumber });
  }
  const brokers = [];
  for (const b of a.brokers) {
    const broker = { ...makeBroker(b.company, b.email), phone: b.phone ?? "", contact: b.contact ?? "", mc: b.mc, language: b.language, authorityVerified: b.verified, ...(b.verified ? { verifiedAt: new Date().toISOString(), verifyNote: "Simulated broker" } : {}) };
    await save("records", id, broker as unknown as Item, "broker");
    brokers.push({ id: broker.id, company: broker.company, email: broker.email });
  }
  // Loads already on the road, for the drivers' side of the week (running late, breakdowns, detention).
  const loads = [];
  for (const l of a.loads) {
    const truck = trucks.get(l.unitNumber);
    const broker = brokers.find((b) => b.company === l.broker);
    if (!truck || !broker) continue;
    const at = (h: number) => new Date(Date.now() + h * 3600_000);
    const window = (d: Date) => d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    const load = {
      ...makeLoad({ truckId: truck.id, brokerId: broker.id, referenceNumber: l.ref, originCity: l.origin[0], originState: l.origin[1], destinationCity: l.destination[0], destinationState: l.destination[1], miles: l.miles, pickupWindow: window(at(l.pickupInHours)), deliveryWindow: window(at(l.deliveryInHours)), pickupAt: at(l.pickupInHours).toISOString(), deliveryAt: at(l.deliveryInHours).toISOString(), rate: l.rate, equipment: truck.equipmentType }, { ...makeBroker(broker.company, broker.email), id: broker.id }, truck, "dispatched"),
      stage: l.stage,
      brokerContactEmail: broker.email,
    };
    await save("loads", id, load as unknown as Item);
    await save("trucks", id, { ...truck, status: "on_load", currentLoadId: load.id } as unknown as Item);
    loads.push({ id: load.id, ref: load.referenceNumber, unitNumber: truck.unitNumber });
  }
  return { carrier: id, inboundKey: (row as { inbound_key: string }).inbound_key, drivers, brokers, loads };
}
