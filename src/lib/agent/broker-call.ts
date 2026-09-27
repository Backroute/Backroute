import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { AI_MODEL, FALLBACK, aiConfigured, claude } from "../ai/server";
import { inboundAddress } from "../channels/email";
import { canCallOut, startCall } from "../channels/twilio";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import type { Load } from "../types";
import { addActivity, claimMark, logChannel, releaseMark, save, threadWith, type CarrierContext } from "./db";
import { event, passToOwner } from "./dispatcher";
import { floorFor } from "./pricing";
import { ourNumbers, respond, withOurMove, withTheirOffer } from "./negotiation";
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

/** The most a truck like ours can legally carry, roughly (80,000 lbs gross less the truck and trailer). */
const MAX_LBS: Record<Load["equipmentType"], number> = { "Dry Van": 45000, Reefer: 43500, Flatbed: 48000, Container: 44000 };

/** Why the freight is too heavy for our truck, or null when it fits. */
export function overweight(load: Pick<Load, "weight" | "equipmentType">): string | null {
  const max = MAX_LBS[load.equipmentType] ?? 45000;
  return load.weight > max ? `at ${load.weight.toLocaleString("en-US")} pounds it's over what our ${load.equipmentType.toLowerCase()} can legally carry (about ${max.toLocaleString("en-US")}).` : null;
}

/** What we know about the freight, so the AI asks only for what's missing. */
function freightNote(load: Load): string {
  const known = [load.commodity ? `commodity ${load.commodity}` : null, load.weight ? `${load.weight.toLocaleString("en-US")} pounds` : null, load.appointmentNote ? `appointments: ${load.appointmentNote}` : null].filter(Boolean);
  const missing = [!load.commodity && "commodity", !load.weight && "weight", !load.appointmentNote && "appointments"].filter(Boolean);
  return `${known.length ? ` Known: ${known.join(", ")}.` : ""}${missing.length ? ` Still to ask: ${missing.join(", ")}.` : ""}`;
}

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
  return `Hi, this is the AI dispatcher for ${ctx.carrier.name}${ctx.carrier.mc ? `, MC ${ctx.carrier.mc.replace(/\D/g, "").split("").join(" ")}` : ""}. This call is transcribed. I'm calling on your load ${load.referenceNumber}, ${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}, picking up ${load.pickupWindow}. We've got a ${load.equipmentType.toLowerCase()} ready for it, and we'd run it for ${money(ask)} all in. Can we lock it in?`;
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

const BROKER_CALL = `You're a truck dispatcher on the phone with a freight broker, booking one load for a small carrier. You already said who you are, that you're an AI, that the call is transcribed, and our price. Talk like an experienced dispatcher: friendly, quick, confident, a little casual ("yeah", "gotcha", "I hear you"). Your words are spoken by a voice: one or two short sentences a turn, no lists or symbols, say numbers the way people say them ("twenty-one fifty").

How you work the price:
- Every time the broker names a price, call broker_offer with it first, then say what it tells you in your own words, with the reason it gives. Never name, agree to or hint at a number yourself; the tools decide every number.
- Don't give up the rate you were told in one go, and don't sound desperate. If they push, acknowledge them ("I hear you") and restate the number with the reason.
- If the broker asks what your best is, call broker_offer with their last number (or our ask if they haven't named one) and say what it tells you.
- When the broker agrees to a price the tools gave you, call booked.

Before you book, like any dispatcher, get the details you don't have: what's the commodity, the weight, and are the pickup and delivery appointments set. Call load_details with what they say. If it says we can't haul it, say so politely.

After booking:
- If you don't have their MC number yet (the tools will say), ask for it and call broker_mc.
- If the tools ask for an email address, get it, read it back, and call broker_email.
- Ask them to send the rate con, and mention detention and TONU should be on it.

Other things:
- If the load is covered or cancelled, call not_available.
- Stick to this load. Anything you can't answer, say someone from the office will follow up by email.
- When you're done, say a short goodbye and call hang_up.`;

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
  // Prices the rules accepted; "booked" only takes one of these. Earlier turns count: our ask and every number we've
  // said (a counter becomes the ask), and offers the rules took on this call.
  const accepted = new Set<number>(ourNumbers(current.bookRequest, current.targetRate));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: BetaRunnableTool<any>[] = [
    betaZodTool({
      name: "broker_offer",
      description: "The broker named a price (all-in total, dollars), or asked for our best. Returns what the carrier's rules say to answer, and a reason to give.",
      inputSchema: z.object({ amount: z.number().positive() }),
      run: async ({ amount }) => {
        const ours = current.bookRequest?.ask ?? current.targetRate;
        const move = respond(amount, current, ctx.settings);
        const request = withOurMove(withTheirOffer(current.bookRequest, ours, amount, "phone"), move, "phone");
        await persist({ bookRequest: request, ...(move.action === "counter" ? { targetRate: move.amount } : {}), ...(move.action === "pass" ? { stage: "declined" as const } : {}) });
        if (move.action === "accept") {
          accepted.add(amount);
          return `Accept: ${amount} dollars works. Agree and book it at ${amount}.`;
        }
        if (move.action === "counter") {
          accepted.add(move.amount);
          const say = move.held ? `hold at ${move.amount} dollars all in; they haven't moved` : move.final ? `say the best you can do is ${move.amount} dollars all in` : `say you can come down to ${move.amount} dollars all in`;
          return `Counter: ${say}. Reason to give: ${move.reason} If they agree to ${move.amount}, book it.`;
        }
        if (move.action === "pass") {
          await addActivity(ctx.carrier.id, event({ type: "call_completed", loadId: current.id, message: `Passed on ${current.referenceNumber} at $${amount.toLocaleString()}`, detail: `Our lowest was $${move.amount.toLocaleString()}`, severity: "info" }));
          return `Pass: say you can't make ${amount} work, ${move.amount} is as low as you can go, and to call or email if that changes. Then say goodbye and call hang_up.`;
        }
        await passToOwner(ctx, { reason: `${ctx.brokers.find((b) => b.id === current.brokerId)?.company ?? "The broker"} offered $${amount.toLocaleString()} by phone on ${current.referenceNumber}. ${move.why}`, loadId: current.id, label: "Decided", source: "voice", to: "decider" });
        return `Don't agree. Say you have to run it by the office and will email back shortly.`;
      },
    }),
    betaZodTool({
      name: "booked",
      description: "The broker agreed to book the load at this price, which the tools already accepted.",
      inputSchema: z.object({ amount: z.number().positive() }),
      run: async ({ amount }) => {
        const floor = floorFor(current, ctx.settings);
        if (!accepted.has(amount) || (floor !== null && amount < floor)) return `Not booked: ${amount} wasn't accepted by the rules. Don't agree to it; call broker_offer with it.`;
        const tooHeavy = overweight(current);
        if (tooHeavy) return `Not booked: ${tooHeavy} Say so politely, thank them, and end the call.`;
        const broker = ctx.brokers.find((b) => b.id === current.brokerId);
        if (broker && assessBroker(broker, ctx.settings.brokerOverrides).policy === "block")
          return broker.mc ? "Not booked: this broker didn't pass the check. Say the office will confirm by email and end the call." : "Not booked yet: this broker isn't checked. Ask for their MC number and call broker_mc with it first.";
        await persist({ stage: "negotiating", targetRate: amount, bookRequest: { ...(current.bookRequest ?? { askedAt: new Date().toISOString() }), ask: amount, brokerOffer: amount, status: "accepted" } as Load["bookRequest"] });
        await addActivity(ctx.carrier.id, event({ type: "call_completed", loadId: current.id, message: `Broker agreed on the phone: $${amount.toLocaleString()}`, detail: `${current.referenceNumber} · waiting on their rate con`, severity: "success" }));
        const terms = "Ask them to put detention and TONU on the rate con.";
        if (broker && !broker.email) return `Booked, pending the rate con. Ask for the email address to send our confirmation and carrier packet to, and call broker_email with it. ${terms}`;
        return `Booked, pending the rate con. Ask them to email the rate confirmation. ${terms}`;
      },
    }),
    betaZodTool({
      name: "load_details",
      description: "What the broker said about the freight: commodity, weight in pounds, hazmat, and whether appointments are set. Checks it fits our truck.",
      inputSchema: z.object({
        commodity: z.string().optional(),
        weightLbs: z.number().positive().optional(),
        hazmat: z.boolean().optional(),
        appointments: z.string().optional().describe("Pickup and delivery appointment times, or first-come-first-served, as they said it"),
      }),
      run: async ({ commodity, weightLbs, hazmat, appointments }) => {
        await persist({
          ...(commodity ? { commodity } : {}),
          ...(weightLbs ? { weight: weightLbs } : {}),
          ...(hazmat !== undefined ? { hazmat } : {}),
          ...(appointments ? { appointmentNote: appointments } : {}),
        });
        const tooHeavy = overweight(current);
        if (tooHeavy) {
          await persist({ stage: "declined", bookRequest: current.bookRequest ? { ...current.bookRequest, status: "declined" } : undefined });
          return `We can't haul it: ${tooHeavy} Tell them politely, thank them, and end the call.`;
        }
        if (current.hazmat && !ctx.settings.hazmat) {
          await passToOwner(ctx, { reason: `${current.referenceNumber} is hazmat${commodity ? ` (${commodity})` : ""}. The AI didn't book it: is the truck and driver set up for hazmat?`, loadId: current.id, label: "Decided", source: "voice", to: "owner" });
          return "Hazmat: don't book. Say you need to check hazmat with the office and will email back.";
        }
        return "Noted. It fits our truck.";
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
        { type: "text", text: `Carrier: ${ctx.carrier.name}. Load ${current.referenceNumber}: ${current.lane.origin}, ${current.lane.originState} to ${current.lane.destination}, ${current.lane.destState}, ${current.lane.miles} miles, pickup ${current.pickupWindow}, delivery ${current.deliveryWindow}, ${current.equipmentType}. Our ask: ${current.bookRequest?.ask ?? current.targetRate} dollars all in.${freightNote(current)}${memoryNote(ctx.loads, ctx.brokers, current) ? ` ${memoryNote(ctx.loads, ctx.brokers, current)} Use history only to sound informed; prices still come from the tools.` : ""}` },
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

const SORRY = "Sorry, I'll have someone from the office follow up by email. Thanks.";

/** One turn of a call with a broker, by either kind of call: logged, answered inside the rules. */
export async function brokerCallReply(ctx: CarrierContext, load: Load, callSid: string, said: string, data: Record<string, unknown> = {}): Promise<{ reply: string; hangUp: boolean }> {
  const key = brokerCallKey(callSid);
  const earlier = await threadWith(ctx.carrier.id, "voice", key, 16);
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "in", counterparty: key, body: said, data: { kind: "broker_call", loadId: load.id, ...data } });
  const history = earlier.map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
  const result = aiConfigured() ? await brokerCallTurn(ctx, load, said, history) : { reply: "", hangUp: true, failed: true };
  if (result.failed) {
    await passToOwner(ctx, { reason: `The AI's call with the broker about ${load.referenceNumber} broke off after they said: "${said}". Follow up with them.`, loadId: load.id, label: "Followed up", source: "voice", to: "support" });
    await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", counterparty: key, body: SORRY, data: { kind: "broker_call", loadId: load.id } });
    return { reply: SORRY, hangUp: true };
  }
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", counterparty: key, body: result.reply, data: { kind: "broker_call", loadId: load.id } });
  return { reply: result.reply, hangUp: result.hangUp };
}
