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
import { dryRun, event, passToOwner } from "./dispatcher";
import { floorFor, spokenEmail } from "./pricing";
import { ourNumber, ourNumbers, respond, withOurMove, withTheirOffer } from "./negotiation";
import { estimateMiles } from "../fleet";
import { askSupportAboutBroker, checkBroker } from "./brokers";
import { assessBroker } from "../broker-policy";
import { confirmPhoneBooking, sendSetupPacket } from "./paperwork";
import { memoryNote } from "./memory";
import { when } from "./templates";
import { TRUCKING } from "../ai/prompts";

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

/**
 * What the AI says when the broker picks up. Like a dispatcher: who's calling (and that it's an AI), which load, and
 * whether it's still available. The price comes after, once the broker names theirs or asks for ours.
 */
export function brokerCallOpening(ctx: CarrierContext, load: Load): string {
  return `Hi, this is the AI dispatcher for ${ctx.carrier.name}${ctx.carrier.mc ? `, MC ${ctx.carrier.mc.replace(/\D/g, "").split("").join(" ")}` : ""}. This call is transcribed. I'm calling on your ${load.lane.origin} to ${load.lane.destination} load, ${load.referenceNumber}, picking up ${when(load.pickupWindow)}. Is it still available?`;
}

/** A broker calling back the number the AI called them from: pick up where that call left off. */
export function brokerCallBackOpening(ctx: CarrierContext, load: Load): string {
  return `${ctx.carrier.name} dispatch, this is the AI dispatcher. This call is transcribed. Thanks for calling back about your ${load.lane.origin} to ${load.lane.destination} load, ${load.referenceNumber}. Is it still available?`;
}

/** Where the load's truck is, the way a dispatcher tells a broker: empty somewhere now, or unloading somewhere soon. */
export function truckAt(ctx: Pick<CarrierContext, "trucks" | "loads">, load: Load): string | null {
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  if (!truck) return null;
  const on = ctx.loads.find((l) => l.id === truck.currentLoadId && l.id !== load.id);
  if (on) return `unloading in ${on.lane.destination}, ${on.lane.destState}${on.deliveryWindow ? ` (${when(on.deliveryWindow)})` : ""}`;
  const where = truck.position?.description ?? `${truck.currentCity}, ${truck.currentState}`;
  return truck.status === "available" ? `empty in ${where}` : `in ${where}`;
}

/** What a broker asks a dispatcher about the truck, the driver and the company, answered from the carrier's data. */
export function brokerFacts(ctx: CarrierContext, load: Load): string[] {
  const facts: string[] = [];
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  const at = truckAt(ctx, load);
  if (truck && at) {
    facts.push(`Truck ${truck.unitNumber}, a ${truck.equipmentType.toLowerCase()}, is ${at}.`);
    const miles = estimateMiles({ city: truck.currentCity, state: truck.currentState }, { city: load.lane.origin, state: load.lane.originState });
    if (miles !== null && !truck.currentLoadId) {
      facts.push(miles < 25 ? "It's right by the pickup." : `It's about ${miles} miles from the pickup, roughly ${Math.max(1, Math.round(miles / 50))} hour${Math.round(miles / 50) > 1 ? "s" : ""} away.`);
      if (truck.status === "available" && miles < 60) facts.push("It's empty nearby now, so it can load early if the shipper allows.");
    }
    const driver = ctx.drivers.find((d) => d.id === truck.driverId);
    if (driver) facts.push(`Driver: ${driver.name.split(" ")[0]}${typeof driver.hoursRemaining === "number" ? `, ${Math.floor(driver.hoursRemaining)} hours left to drive today` : ""}.`);
    if (truck.secondDriverId) facts.push("It's a team truck.");
    if (truck.position) facts.push("We track the truck by ELD and send check calls with its location.");
  }
  facts.push(`Pickup ${when(load.pickupWindow)}, delivery ${when(load.deliveryWindow)}.`);
  if (ctx.carrier.mc) facts.push(`Our MC is ${ctx.carrier.mc}.`);
  facts.push("Our W-9, insurance certificate and authority go out with the carrier packet by email.");
  if (ctx.settings.factoringEmail) facts.push("We factor our invoices; the notice of assignment comes with the packet.");
  return facts;
}

function factsNote(ctx: CarrierContext, load: Load): string {
  return ` Facts you can give the broker: ${brokerFacts(ctx, load).join(" ")}`;
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

const BROKER_CALL = `You're a truck dispatcher on the phone with a freight broker, booking one load for a small carrier. You already said who you are, that you're an AI and that the call is transcribed, and asked if the load is still available. Talk like an experienced dispatcher: friendly, quick, confident, a little casual ("yeah", "gotcha", "I hear you", "appreciate it"). Use the broker's first name once you know it. Your words are spoken by a voice: one or two short sentences a turn, no lists or symbols, say numbers the way people say them ("twenty-one fifty", "two eighty a mile").

How the call goes, like any dispatcher's:
1. Covered or cancelled: call not_available, thank them, say bye, and call hang_up.
2. Available: get what you don't know yet about the freight (commodity, weight, are appointments set) and call load_details with what they say. If it says we can't haul it, say so politely.
3. Ask what it pays ("What are you paying on it?"). When they name a number, a total or a rate per mile, call broker_offer. If they ask what you need, or won't give a number first, call our_price.
4. Work the price only through the tools, and say each answer in your own words with the reason it gives. Don't give up ground in one go and don't sound desperate. If they push without moving, acknowledge them and restate the number. On your last number, tell them if they can do it, you'll book it right now.
5. When they agree to a price the tools gave you, call booked and do what it says (MC number, email for the confirmation). Ask them to send the rate con with detention and TONU on it.
6. Wrap up with a quick thanks and bye, then call hang_up.

Rules:
- Never name, agree to or hint at a number the tools didn't give you.
- Answer questions about the truck, the driver and the company only from the facts you're given. If you don't have it, say you'll confirm by email. Never make anything up.
- If they ask for our carrier packet or setup papers, call send_packet.
- If they ask something about this load you can't answer from the facts (their rules, a detail you don't have), say the office will confirm by email, then call follow_up with the question so someone does.
- Stick to this load.

${TRUCKING}`;

export interface CallTurnResult {
  reply: string;
  hangUp: boolean;
  failed?: boolean;
}

/** One turn of the call: what the broker said, and what the AI says back (with whatever it did). */
export async function brokerCallTurn(ctx: CarrierContext, load: Load, said: string, history: { from: "them" | "ai"; text: string }[], dry?: { tool: string; input: unknown }[]): Promise<CallTurnResult> {
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
      description: "The broker named a price: an all-in total in dollars, or a rate per mile. Returns what the carrier's rules say to answer, and a reason to give.",
      inputSchema: z.object({
        amount: z.number().positive().optional().describe("All-in total in dollars"),
        perMile: z.number().positive().optional().describe("Rate per loaded mile in dollars, when that's how they said it"),
      }),
      run: async ({ amount: said, perMile }) => {
        // "Two eighty a mile" is a rate per mile, however it was passed.
        const rate = perMile ?? (said !== undefined && said < 20 ? said : undefined);
        const amount = rate !== undefined ? Math.round(rate * current.lane.miles) : said;
        if (!amount) return "Ask them what the number is.";
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
          const say = move.split
            ? `say you're close and offer to meet in the middle at ${move.amount} dollars all in`
            : move.held
              ? `hold at ${move.amount} dollars all in; they haven't moved`
              : move.final
                ? `say the best you can do is ${move.amount} dollars all in, and if they can do ${move.amount} you'll book it right now`
                : `say you can come down to ${move.amount} dollars all in`;
          return `Counter: ${say}.${rate !== undefined ? ` (Their ${rate.toFixed(2)} a mile is ${amount} dollars.)` : ""} Reason to give: ${move.reason} If they agree to ${move.amount}, book it.`;
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
      name: "our_price",
      description: "The broker asked what we need on the load, or won't name a number first. Returns our number and a reason for it.",
      inputSchema: z.object({}),
      run: async () => {
        const ours = ourNumber(current);
        accepted.add(ours.amount);
        return `Say we'd need ${ours.amount} dollars all in (${(ours.amount / Math.max(1, current.lane.miles)).toFixed(2)} a mile). Reason to give: ${ours.reason} If they agree to ${ours.amount}, book it.`;
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
        const address = spokenEmail(email);
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
      name: "follow_up",
      description: "Something the broker asked that you couldn't answer from the facts. The office follows up by email.",
      inputSchema: z.object({ question: z.string() }),
      run: async ({ question }) => {
        await passToOwner(ctx, { reason: `${ctx.brokers.find((b) => b.id === current.brokerId)?.company ?? "The broker"} asked on the phone about ${current.referenceNumber}: "${question}". Answer them by email.`, loadId: current.id, label: "Answered", source: "voice", to: "support" });
        return "Noted for the office. Tell them someone will email the answer shortly.";
      },
    }),
    betaZodTool({
      name: "send_packet",
      description: "The broker asked for our carrier packet or setup papers (W-9, insurance certificate, authority). Sends them by email.",
      inputSchema: z.object({ email: z.string().optional().describe("Where to send it, if they gave an address") }),
      run: async ({ email }) => {
        const broker = ctx.brokers.find((b) => b.id === current.brokerId);
        const address = spokenEmail(email ?? "") || current.brokerContactEmail || broker?.email;
        if (!address || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(address)) return "Ask for the email address to send the packet to, spell it back, and call send_packet with it.";
        await sendSetupPacket(ctx, { from: address, fromName: broker?.company ?? address, subject: `Carrier packet: ${ctx.carrier.name}`, contactName: null });
        return `Packet on its way to ${address} (or the office will send it shortly if a paper is missing). Tell them.`;
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
        { type: "text", text: `Carrier: ${ctx.carrier.name}. Load ${current.referenceNumber}: ${current.lane.origin}, ${current.lane.originState} to ${current.lane.destination}, ${current.lane.destState}, ${current.lane.miles} miles, pickup ${current.pickupWindow}, delivery ${current.deliveryWindow}, ${current.equipmentType}. Loaded miles: ${current.lane.miles}. Prices come only from the tools.${freightNote(current)}${factsNote(ctx, current)}${memoryNote(ctx.loads, ctx.brokers, current) ? ` ${memoryNote(ctx.loads, ctx.brokers, current)} Use history only to sound informed; prices still come from the tools.` : ""}` },
      ],
      messages,
      tools: dry ? dryRun(tools, dry) : tools,
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
