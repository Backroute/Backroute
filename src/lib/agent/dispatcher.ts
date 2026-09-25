import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { AI_MODEL, FALLBACK, claude } from "../ai/server";
import { DRIVER_SYSTEM, OWNER_SYSTEM } from "../ai/prompts";
import { driverSnapshot, ownerSnapshot } from "../ai/snapshot";
import { LANG_INFO } from "../lang/pack";
import { PRIMARY_CARRIER_ID } from "../mock-data";
import { LOAD_STAGE_LABEL, LOAD_STAGE_ORDER, type ActivityEvent, type Driver, type Escalation, type Load, type LoadStage, type MessageChannel } from "../types";
import type { Item } from "../cloud/rows";
import { addActivity, save, type CarrierContext } from "./db";

/**
 * The AI dispatcher on the server: one brain behind texts, calls and email. It reads the carrier's data, answers,
 * and acts through a small set of tools. What a driver reports about their own load it does right away; anything
 * that speaks for the carrier to someone outside (a broker) waits for the owner unless autopilot is on full.
 */

// Rows carry the app's own carrier id so the owner's dashboard shows them; the real id is the row's carrier_id.
const ALIAS = PRIMARY_CARRIER_ID;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

export interface Effects {
  /** What the AI did, in plain words, for the log. */
  done: string[];
  hangUp?: boolean;
  /** Set when the brain couldn't answer (no key, refusal, error): the caller sends a safe fallback instead. */
  failed?: boolean;
}

function snapshotSource(ctx: CarrierContext) {
  return { carriers: [], trucks: ctx.trucks, drivers: ctx.drivers, loads: ctx.loads, brokers: ctx.brokers, escalations: ctx.escalations, settings: ctx.settings };
}

function event(p: Omit<ActivityEvent, "id" | "timestamp" | "carrierId">): ActivityEvent {
  return { id: uid("act"), timestamp: now(), carrierId: ALIAS, ...p };
}

async function raise(ctx: CarrierContext, p: { reason: string; loadId?: string; critical?: boolean; label?: string; source: MessageChannel }) {
  const escalation: Escalation = {
    id: uid("esc"),
    loadId: p.loadId ?? "",
    carrierId: ALIAS,
    reason: p.reason,
    createdAt: now(),
    status: "open",
    complexity: p.critical ? "critical" : "routine",
    recommendedAction: "approve",
    recommendedLabel: p.label ?? "Got it",
    source: p.source,
  };
  await save("escalations", ctx.carrier.id, escalation as unknown as Item);
  ctx.escalations.unshift(escalation);
  return escalation;
}

// ─── Driver conversations: text and phone ────────────────────────────────────

/** What a driver can report by text or on a call, in their words, mapped to the load's stage. */
const REPORTS = { at_pickup: "at_pickup", loaded: "in_transit", at_delivery: "at_delivery" } as const satisfies Record<string, LoadStage>;

function driverTools(ctx: CarrierContext, driver: Driver, channel: "sms" | "voice", effects: Effects) {
  const first = driver.name.split(" ")[0];
  const truck = ctx.trucks.find((t) => t.id === driver.truckId || t.secondDriverId === driver.id);
  const theirLoads = () => ctx.loads.filter((l) => l.truckId && l.truckId === truck?.id);
  const current = () =>
    theirLoads().find((l) => l.id === truck?.currentLoadId) ??
    theirLoads().find((l) => ["booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "rate_confirmed"].includes(l.stage));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: BetaRunnableTool<any>[] = [
    betaZodTool({
      name: "update_load_status",
      description:
        "Record where the driver is with a load, when they tell you: arrived at pickup, loaded and rolling, or arrived at delivery. Only for their own loads, and only moving forward. Delivery itself is confirmed in the app with the signed POD photo, so you can't mark a load delivered.",
      inputSchema: z.object({
        load_ref: z.string().optional().describe("The load's reference number. Leave out to use their current load."),
        status: z.enum(["at_pickup", "loaded", "at_delivery"]),
      }),
      run: async ({ load_ref, status }) => {
        const load = load_ref ? theirLoads().find((l) => l.referenceNumber.toLowerCase() === load_ref.toLowerCase()) : current();
        if (!load) return "Not changed: no load on this driver's truck matches. Ask which load they mean.";
        const target = REPORTS[status];
        if (LOAD_STAGE_ORDER.indexOf(target) <= LOAD_STAGE_ORDER.indexOf(load.stage))
          return `Not changed: ${load.referenceNumber} is already ${LOAD_STAGE_LABEL[load.stage]}.`;
        const at = now();
        // The times go on the trip checklist too: they start and stop the dock clock for detention.
        const times = { at_pickup: { arrivedPickupAt: at }, in_transit: { loadedAt: at }, at_delivery: { arrivedDeliveryAt: at } }[target];
        const tripChecklist = { ...load.tripChecklist, ...Object.fromEntries(Object.entries(times).filter(([k]) => !load.tripChecklist?.[k as keyof typeof times])) };
        const updated: Load = { ...load, stage: target, tripChecklist, ticksInStage: 0, updatedAt: at, progressPct: target === "at_pickup" ? 20 : target === "in_transit" ? 45 : 90 };
        await save("loads", ctx.carrier.id, updated as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === load.id ? updated : l));
        await addActivity(
          ctx.carrier.id,
          event({ type: "check_call", loadId: load.id, message: `${first}: ${LOAD_STAGE_LABEL[target].toLowerCase()}`, detail: `${load.lane.origin} → ${load.lane.destination} · by ${channel === "sms" ? "text" : "phone"}`, severity: "info" }),
        );
        effects.done.push(`Marked ${load.referenceNumber} ${LOAD_STAGE_LABEL[target]}`);
        return `Done: ${load.referenceNumber} is now ${LOAD_STAGE_LABEL[target]}.`;
      },
    }),
    betaZodTool({
      name: "report_problem",
      description:
        "Tell the owner about a problem on the road: breakdown, accident, running late, weather, a problem at the dock, a safety concern. For a crash, injury or danger, set urgent and tell the driver to call 911 first.",
      inputSchema: z.object({
        kind: z.enum(["breakdown", "accident", "late", "weather", "dock", "safety", "other"]),
        details: z.string().describe("What happened, where, and what the driver needs, in a sentence or two."),
        urgent: z.boolean(),
      }),
      run: async ({ kind, details, urgent }) => {
        const load = current();
        await raise(ctx, {
          reason: `${driver.name} (${kind}): ${details}`,
          loadId: load?.id,
          critical: urgent || kind === "accident",
          label: "I've handled it",
          source: channel,
        });
        await addActivity(ctx.carrier.id, event({ type: "incident", loadId: load?.id, message: `${first} reported a problem: ${kind}`, detail: details, severity: urgent ? "danger" : "warning" }));
        effects.done.push(`Told the owner: ${kind}`);
        return "The owner has been told and it's on their Needs you list.";
      },
    }),
    betaZodTool({
      name: "tell_owner",
      description: "Pass a message to the owner that needs a person: a question you can't answer from the data, a request for a call back, pay or time off.",
      inputSchema: z.object({ message: z.string() }),
      run: async ({ message }) => {
        await raise(ctx, { reason: `${driver.name} says: ${message}`, loadId: current()?.id, label: "Got it", source: channel });
        effects.done.push("Passed a message to the owner");
        return "Passed to the owner.";
      },
    }),
  ];
  if (channel === "voice")
    tools.push(
      betaZodTool({
        name: "hang_up",
        description: "End the call after your goodbye, once the driver has nothing else.",
        inputSchema: z.object({}),
        run: async () => {
          effects.hangUp = true;
          return "The call will end after your reply.";
        },
      }),
    );
  return tools;
}

const CHANNEL_NOTES = {
  sms: `You're texting with the driver by SMS. Keep each reply short, under 300 characters when you can, plain text only.`,
  voice: `You're on a phone call with the driver. Your words are read out by a voice, so answer in one or two short spoken sentences: no lists, no symbols, say numbers the way people say them. When they're done, say a short goodbye and use hang_up.`,
};

const ACTING = `
You can act with your tools. When the driver tells you they've arrived, are loaded, or reached delivery, update the load. When they report a problem, report it. When they need a person, tell the owner. Only say you did something after the tool says it's done.`;

export interface Turn {
  from: "them" | "ai";
  text: string;
}

/** One reply to a driver, by text or on a call, with whatever the AI did along the way. */
export async function driverTurn(ctx: CarrierContext, driver: Driver, channel: "sms" | "voice", said: string, history: Turn[]): Promise<{ reply: string; effects: Effects }> {
  const effects: Effects = { done: [] };
  const lang = LANG_INFO[driver.prefs?.language ?? "en"];
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.from === "them" ? "user" : "assistant", content: t.text }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({
    role: "user",
    content: [
      { type: "text", text: `Fleet data right now (${new Date().toUTCString()}), for ${driver.name}:\n${JSON.stringify(driverSnapshot(snapshotSource(ctx), driver.id))}` },
      { type: "text", text: `${channel === "voice" ? "The driver said" : "The driver texted"} (their language is ${lang.english}; answer in it): ${said}` },
    ],
  });

  try {
    const final = await claude().beta.messages.toolRunner({
      model: AI_MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: channel === "voice" ? "low" : "medium" },
      system: [
        { type: "text", text: DRIVER_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: `${CHANNEL_NOTES[channel]}${ACTING}` },
      ],
      messages,
      tools: driverTools(ctx, driver, channel, effects),
      max_iterations: 5,
    });
    if (final.stop_reason === "refusal") return { reply: "", effects: { ...effects, failed: true } };
    const reply = textOf(final);
    return { reply, effects: reply ? effects : { ...effects, failed: true } };
  } catch (error) {
    console.error("[dispatcher] driver turn failed", error instanceof Anthropic.APIError ? error.status : error);
    return { reply: "", effects: { ...effects, failed: true } };
  }
}

function textOf(message: Anthropic.Beta.BetaMessage) {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ─── Broker email ────────────────────────────────────────────────────────────

const BROKER_NOTES = `
Now you're handling the carrier's email with a freight broker. Write the reply the carrier would send: short, professional, first person plural ("we"), signed with the carrier's name. Never agree to a lower rate, extra fees or changed terms, and never commit a truck the data doesn't show as free; for those, say you'll confirm and use flag_for_owner. Don't invent load details. If the email needs no reply (an automated notice, a thank-you), write exactly NO_REPLY.`;

export interface BrokerEmail {
  from: string;
  fromName?: string;
  subject: string;
  text: string;
  /** What the AI found in attached rate cons, already checked against the load. */
  attachmentNotes: string[];
  thread: { direction: string; body: string | null }[];
  load?: Load;
}

/** A reply to a broker's email, as a draft. Whether it's sent now or waits for the owner is the caller's call. */
export async function brokerEmailDraft(ctx: CarrierContext, email: BrokerEmail): Promise<{ body: string | null; effects: Effects }> {
  const effects: Effects = { done: [] };
  const tools = [
    betaZodTool({
      name: "flag_for_owner",
      description: "Ask the owner to decide something in this email: a rate change, extra fees, a truck request, anything you shouldn't agree to yourself.",
      inputSchema: z.object({ reason: z.string() }),
      run: async ({ reason }) => {
        await raise(ctx, { reason: `${email.fromName || email.from} (email): ${reason}`, loadId: email.load?.id, label: "I'll handle it", source: "email" });
        effects.done.push("Asked the owner to decide");
        return "The owner will decide. Tell the broker you'll confirm shortly.";
      },
    }),
  ];
  const context = {
    carrier: ctx.carrier.name,
    fleet: ownerSnapshot(snapshotSource(ctx), { ask: "Ask me first", rules: "Within my rules", full: "Full autopilot" }),
    thisLoad: email.load ? { ref: email.load.referenceNumber, lane: `${email.load.lane.origin}, ${email.load.lane.originState} → ${email.load.lane.destination}, ${email.load.lane.destState}`, rate: email.load.bookedRate ?? email.load.targetRate, pickup: email.load.pickupWindow, delivery: email.load.deliveryWindow, stage: LOAD_STAGE_LABEL[email.load.stage] } : null,
    earlierEmails: email.thread.map((t) => ({ direction: t.direction === "in" ? "from broker" : "from us", body: (t.body ?? "").slice(0, 1500) })),
    attachments: email.attachmentNotes,
  };

  try {
    const final = await claude().beta.messages.toolRunner({
      model: AI_MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: OWNER_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: BROKER_NOTES },
      ],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Context:\n${JSON.stringify(context)}` },
            { type: "text", text: `Email from ${email.fromName ? `${email.fromName} <${email.from}>` : email.from}\nSubject: ${email.subject}\n\n${email.text}` },
          ],
        },
      ],
      tools,
      max_iterations: 4,
    });
    if (final.stop_reason === "refusal") return { body: null, effects: { ...effects, failed: true } };
    const body = textOf(final);
    return { body: !body || body === "NO_REPLY" ? null : body, effects };
  } catch (error) {
    console.error("[dispatcher] broker email failed", error instanceof Anthropic.APIError ? error.status : error);
    return { body: null, effects: { ...effects, failed: true } };
  }
}

export { ALIAS, event, uid, raise as passToOwner };
