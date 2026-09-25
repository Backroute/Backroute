import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { AI_MODEL, FALLBACK, claude } from "../ai/server";
import { inboundAddress } from "../channels/email";
import { canCallOut, startCall } from "../channels/twilio";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import type { Load } from "../types";
import { addActivity, claimMark, logChannel, releaseMark, save, type CarrierContext } from "./db";
import { event, passToOwner } from "./dispatcher";
import { answerBroker, floorFor } from "./pricing";
import { askSupportAboutBroker, checkBroker } from "./brokers";
import { assessBroker } from "../broker-policy";
import { confirmPhoneBooking } from "./paperwork";
import { memoryNote } from "./memory";

/**
 * The AI phones a broker about a load, the way a dispatcher follows up an email nobody answered, or books with a
 * broker who only works by phone. It says it's an AI and that the call is transcribed, asks the price the rules set,
 * and every number it agrees to goes through the same rules as email (lib/agent/pricing). The booking is confirmed
 * the same way too: by the broker's rate con, which the AI checks when it arrives by email.
 */

const money = (n: number) => `${n.toLocaleString("en-US")} dollars`;

export const brokerCallKey = (callSid: string) => `broker-call:${callSid}`.toLowerCase();

/** Rings the broker about a load. False when it can't (no phone, calling off, already called about it). */
export async function callBroker(ctx: CarrierContext, load: Load, url: string | null): Promise<boolean> {
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const to = broker?.phone ? toE164(broker.phone) : null;
  if (!to || !url || !canCallOut()) return false;
  if (!(await claimMark(ctx.carrier.id, load.id, "broker_call"))) return false;
  const sid = await startCall(to, url, { machineDetection: true });
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", providerId: sid ? `${sid}:dial` : null, counterparty: to, body: `Calling ${broker!.company} about ${load.referenceNumber}`, data: { kind: "broker_call", loadId: load.id } });
  await addActivity(ctx.carrier.id, event({ type: "call_started", loadId: load.id, message: `AI is calling ${broker!.company}`, detail: `${load.referenceNumber} · asking $${(load.bookRequest?.ask ?? load.targetRate).toLocaleString()}`, severity: "info" }));
  return true;
}

/** What the AI says when the broker picks up. Written out, not generated, so the price is exactly the ask. */
export function brokerCallOpening(ctx: CarrierContext, load: Load): string {
  const ask = load.bookRequest?.ask ?? load.targetRate;
  return `Hi, this is the AI dispatcher for ${ctx.carrier.name}${ctx.carrier.mc ? `, MC ${ctx.carrier.mc.replace(/\D/g, "").split("").join(" ")}` : ""}. This call is transcribed. I'm calling about your load ${load.referenceNumber}, ${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}, picking up ${load.pickupWindow}. We have a ${load.equipmentType.toLowerCase()} ready. Our rate is ${money(ask)} all in. Can we book it?`;
}

export const VOICEMAIL = (ctx: CarrierContext, load: Load) => {
  const hasEmail = !!(load.brokerContactEmail || ctx.brokers.find((b) => b.id === load.brokerId)?.email);
  const ask = money(load.bookRequest?.ask ?? load.targetRate);
  // A broker we only have a phone number for (a board post) gets a second call instead of an email to reply to.
  return hasEmail
    ? `Hi, this is the AI dispatcher for ${ctx.carrier.name}, about your load ${load.referenceNumber}. We'd like to book it at ${ask} all in. Please reply to our email${ctx.carrier.inbound_key && inboundAddress(ctx.carrier.inbound_key) ? " or send the rate confirmation there" : ""}. Thanks.`
    : `Hi, this is the AI dispatcher for ${ctx.carrier.name}, about your posted load ${load.referenceNumber}, ${load.lane.origin} to ${load.lane.destination}. We'd like to book it at ${ask} all in. We'll try you again shortly. Thanks.`;
};

/** Voicemail on a phone-only broker: one more call, on the next follow-up round. */
export async function retryAfterVoicemail(ctx: CarrierContext, load: Load) {
  const hasEmail = !!(load.brokerContactEmail || ctx.brokers.find((b) => b.id === load.brokerId)?.email);
  if (!hasEmail && (await claimMark(ctx.carrier.id, load.id, "broker_call_retry"))) await releaseMark(ctx.carrier.id, load.id, "broker_call");
}

const BROKER_CALL = `You're on a phone call with a freight broker, for a small trucking carrier, about one load. You already told them who you are, that you're an AI, and the carrier's price. Your words are read out by a voice: one or two short spoken sentences, no lists or symbols, say numbers the way people say them.

Rules:
- When the broker names any price, call broker_offer with it before you answer, and say what it tells you. Never agree to or suggest a number yourself.
- When the broker agrees to book at a price the tools accepted, call booked, then tell them to email the rate confirmation and that you'll dispatch when it arrives.
- If you don't have the broker's MC number yet (the tools will say), ask for it and call broker_mc before agreeing to book.
- After booking, if the tools ask for an email address, get it, read it back, and call broker_email.
- If the load is already covered or cancelled, call not_available.
- Don't discuss anything but this load. Anything you can't answer: say someone from the office will follow up by email.
- When the call is done, say a short goodbye and call hang_up.`;

export interface CallTurnResult {
  reply: string;
  hangUp: boolean;
  failed?: boolean;
}

/** One turn of the call: what the broker said, and what the AI says back (with whatever it did). */
export async function brokerCallTurn(ctx: CarrierContext, load: Load, said: string, history: { from: "them" | "ai"; text: string }[]): Promise<CallTurnResult> {
  let hangUp = false;
  let current = load;
  const persist = async (patch: Partial<Load>) => {
    current = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await save("loads", ctx.carrier.id, current as unknown as Item);
    ctx.loads = ctx.loads.map((l) => (l.id === current.id ? current : l));
  };
  // Prices the rules accepted on this call; "booked" only takes one of these. Earlier turns count: our standing ask
  // (a counter becomes the ask) and a broker offer that was at or over the floor.
  const floorNow = floorFor(current, ctx.settings);
  const offered = current.bookRequest?.brokerOffer;
  const accepted = new Set<number>([current.bookRequest?.ask ?? current.targetRate, ...(offered && floorNow !== null && offered >= floorNow ? [offered] : [])]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: BetaRunnableTool<any>[] = [
    betaZodTool({
      name: "broker_offer",
      description: "The broker named a price (all-in total, dollars). Returns what the carrier's rules say to answer.",
      inputSchema: z.object({ amount: z.number().positive() }),
      run: async ({ amount }) => {
        const answer = answerBroker(amount, current, ctx.settings, !!current.bookRequest?.countered);
        const before = current.bookRequest ?? { ask: current.targetRate, askedAt: new Date().toISOString(), status: "sent" as const };
        await persist({ bookRequest: { ...before, brokerOffer: amount, countered: before.countered || answer.action === "counter", ...(answer.action === "counter" ? { ask: answer.amount } : {}) } });
        if (answer.action === "accept") {
          accepted.add(amount);
          return `Accept: ${amount} dollars is fine. Agree to book at ${amount}.`;
        }
        if (answer.action === "counter") {
          accepted.add(answer.amount);
          return `Counter: say the best you can do is ${answer.amount} dollars all in. If they agree to ${answer.amount}, book it.`;
        }
        await passToOwner(ctx, { reason: `${ctx.brokers.find((b) => b.id === current.brokerId)?.company ?? "The broker"} offered $${amount.toLocaleString()} by phone on ${current.referenceNumber}. ${answer.why}`, loadId: current.id, label: "Decided", source: "voice", to: "decider" });
        return `Don't agree. Say you have to check with the office and will email back shortly.`;
      },
    }),
    betaZodTool({
      name: "booked",
      description: "The broker agreed to book the load at this price, which the tools already accepted.",
      inputSchema: z.object({ amount: z.number().positive() }),
      run: async ({ amount }) => {
        const floor = floorFor(current, ctx.settings);
        if (!accepted.has(amount) || (floor !== null && amount < floor)) return `Not booked: ${amount} wasn't accepted by the rules. Don't agree to it; call broker_offer with it.`;
        const broker = ctx.brokers.find((b) => b.id === current.brokerId);
        if (broker && assessBroker(broker, ctx.settings.brokerOverrides).policy === "block")
          return broker.mc ? "Not booked: this broker didn't pass the check. Say the office will confirm by email and end the call." : "Not booked yet: this broker isn't checked. Ask for their MC number and call broker_mc with it first.";
        await persist({ stage: "negotiating", targetRate: amount, bookRequest: { ...(current.bookRequest ?? { askedAt: new Date().toISOString() }), ask: amount, brokerOffer: amount, status: "accepted" } as Load["bookRequest"] });
        await addActivity(ctx.carrier.id, event({ type: "call_completed", loadId: current.id, message: `Broker agreed on the phone: $${amount.toLocaleString()}`, detail: `${current.referenceNumber} · waiting on their rate con`, severity: "success" }));
        if (broker && !broker.email) return "Booked, pending the rate con. Ask for the email address to send our confirmation and carrier packet to, and call broker_email with it.";
        return "Booked, pending the rate con. Ask them to email the rate confirmation.";
      },
    }),
    betaZodTool({
      name: "broker_mc",
      description: "The broker's MC number, when they give it. It's checked with FMCSA before anything is booked.",
      inputSchema: z.object({ mc: z.string() }),
      run: async ({ mc }) => {
        const broker = ctx.brokers.find((b) => b.id === current.brokerId);
        if (!broker) return "No broker on this load.";
        const checked = await checkBroker(ctx, broker, mc);
        if (checked.authorityVerified) return "Checked with FMCSA: active broker authority. You can book at the accepted price.";
        await askSupportAboutBroker(ctx, checked, current.id);
        return "That MC doesn't check out with FMCSA. Don't book. Say the office will confirm by email, thank them, and end the call.";
      },
    }),
    betaZodTool({
      name: "broker_email",
      description: "The email address the broker gave for the confirmation and rate con, after booking. Spell-check it back to them first.",
      inputSchema: z.object({ email: z.string(), name: z.string().optional() }),
      run: async ({ email, name }) => {
        const address = email.trim().toLowerCase().replace(/\s+at\s+/, "@").replace(/\s+dot\s+/g, ".").replace(/\s/g, "");
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(address)) return "That doesn't sound like a full email address. Ask them to spell it.";
        if (current.bookRequest?.status !== "accepted") return "Nothing booked yet: agree on the price first.";
        const broker = ctx.brokers.find((b) => b.id === current.brokerId);
        if (broker && !broker.email) {
          const next = { ...broker, email: address };
          await save("records", ctx.carrier.id, next as unknown as Item, "broker");
          ctx.brokers = ctx.brokers.map((b) => (b.id === next.id ? next : b));
        }
        await persist({ brokerContactEmail: address });
        await confirmPhoneBooking(ctx, current, address, current.bookRequest.ask, name);
        return `Sent the confirmation and our packet to ${address}. Tell them it's on its way and to reply with the rate confirmation.`;
      },
    }),
    betaZodTool({
      name: "not_available",
      description: "The load is already covered or cancelled.",
      inputSchema: z.object({}),
      run: async () => {
        await persist({ stage: "declined", bookRequest: current.bookRequest ? { ...current.bookRequest, status: "declined" } : undefined });
        return "Noted. Thank them and end the call.";
      },
    }),
    betaZodTool({
      name: "hang_up",
      description: "End the call after your goodbye.",
      inputSchema: z.object({}),
      run: async () => {
        hangUp = true;
        return "The call will end after your reply.";
      },
    }),
  ];

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.from === "them" ? "user" : "assistant", content: t.text }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content: `The broker said: ${said}` });
  try {
    const final = await claude().beta.messages.toolRunner({
      model: AI_MODEL,
      max_tokens: 2000,
      ...FALLBACK,
      output_config: { effort: "low" },
      system: [
        { type: "text", text: BROKER_CALL, cache_control: { type: "ephemeral" } },
        { type: "text", text: `Carrier: ${ctx.carrier.name}. Load ${current.referenceNumber}: ${current.lane.origin}, ${current.lane.originState} to ${current.lane.destination}, ${current.lane.destState}, ${current.lane.miles} miles, pickup ${current.pickupWindow}, delivery ${current.deliveryWindow}, ${current.equipmentType}. Our ask: ${current.bookRequest?.ask ?? current.targetRate} dollars all in.${memoryNote(ctx.loads, ctx.brokers, current) ? ` ${memoryNote(ctx.loads, ctx.brokers, current)} Use history only to sound informed; prices still come from the tools.` : ""}` },
      ],
      messages,
      tools,
      max_iterations: 4,
    });
    if (final.stop_reason === "refusal") return { reply: "", hangUp: true, failed: true };
    const reply = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return reply ? { reply, hangUp } : { reply: "", hangUp: true, failed: true };
  } catch (error) {
    console.error("[broker call] turn failed", error instanceof Anthropic.APIError ? error.status : error);
    return { reply: "", hangUp: true, failed: true };
  }
}

/** Book requests nobody answered by email in 30 minutes, to brokers with a phone number: the AI calls. */
export async function followUpByPhone(ctx: CarrierContext, now: number, urlFor: (loadId: string) => string | null): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    const req = load.bookRequest;
    if (load.stage !== "negotiating" || req?.status !== "sent" || Date.parse(req.askedAt) > now - 30 * 60_000 || Date.parse(req.askedAt) < now - 6 * 3600_000) continue;
    if (load.pickupAt && Date.parse(load.pickupAt) < now) continue;
    if (await callBroker(ctx, load, urlFor(load.id))) done.push(`${load.referenceNumber}: called the broker`);
  }
  return done;
}
