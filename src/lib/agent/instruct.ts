import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, FALLBACK, aiConfigured, claude } from "../ai/server";
import type { Item } from "../cloud/rows";
import type { Load } from "../types";
import { addActivity, save, type CarrierContext } from "./db";
import { event } from "./dispatcher";
import { requestBooking } from "./booking";
import { sendOrQueue } from "./outbox";
import { dollarAmounts, floorFor } from "./pricing";
import { addWhy } from "./why";
import * as mail from "./templates";

/**
 * What the owner types on a negotiation ("push for $2,600", "ask if they can load early", "walk away"), done for real:
 * a price goes to the broker as their counter (or their ask on an offer), walking away sends the polite pass, and
 * anything else is written into a short email to the broker in the owner's words. Their typing is the approval, so
 * it goes now. A price under their own lowest still goes: it's their call, and the load says so.
 */

type InstructResult = { done: "counter" | "ask" | "pass" | "relay"; amount?: number; note: string } | { error: string };

const WALK = /\b(walk away|pass on it|pass|decline|forget it|drop it|no thanks|not interested)\b/i;

const RELAY = `You're a truck dispatcher. The carrier's owner told you what to ask or tell a freight broker about one load. Write just that as one or two short sentences to the broker, the way a dispatcher would put it in an email: plain, polite, no greeting or sign-off. Don't add prices, promises or terms the owner didn't say.`;

async function relayLine(text: string): Promise<string> {
  if (!aiConfigured()) return text;
  try {
    const message = await claude().beta.messages.create({ model: AI_MODEL, max_tokens: 400, ...FALLBACK, output_config: { effort: "low" }, system: RELAY, messages: [{ role: "user", content: text }] });
    const out = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    // A price the owner didn't say never gets into it.
    const said = new Set(dollarAmounts(text));
    return out && dollarAmounts(out).every((a) => said.has(a)) ? out : text;
  } catch {
    return text;
  }
}

/** The price the owner named: "$2,600", "2.6k", or a bare number after "for/at/counter/ask" (not a time or a load number). */
function priceIn(text: string): number | undefined {
  const explicit = dollarAmounts(text)[0];
  if (explicit) return explicit;
  const m = text.match(/\b(?:for|counter(?: at)?|ask(?: for)?|offer|rate(?: of)?|at|to)\s+([1-9]\d{0,1},\d{3}|[1-9]\d{2,4})(?:\s*(k)\b)?(?!\s*(?:am|pm|a\.m|p\.m|hrs?|hours|mi|miles|lbs|pounds|:))/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return n >= 300 ? n : undefined;
}

export async function ownerInstruction(ctx: CarrierContext, load: Load, text: string): Promise<InstructResult> {
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const to = load.brokerContactEmail ?? broker?.email;
  const name = broker?.contact || undefined;
  const subject = mail.subjectFor(load);
  const amount = priceIn(text);
  const floor = floorFor(load, ctx.settings);
  const under = amount && floor && amount < floor ? ` That's under your lowest ($${floor.toLocaleString()}); it went because you asked.` : "";

  if (WALK.test(text) && !amount) {
    if (!to) return { error: "no_broker_email" };
    const ours = load.bookRequest?.ask ?? load.targetRate;
    await sendOrQueue(ctx, { purpose: "pass", to, toName: name, subject, body: mail.pass(ctx.carrier, ctx.settings, load, ours, load.bookRequest?.brokerOffer ?? ours, name), loadId: load.id, amount: ours, withinRules: true, ownerAsked: true, why: "You asked to walk away." });
    const gone: Load = addWhy({ ...load, stage: "declined", updatedAt: new Date().toISOString(), bookRequest: load.bookRequest ? { ...load.bookRequest, passedAt: new Date().toISOString() } : undefined }, "You walked away; the broker got a polite pass, leaving the door open.");
    await save("loads", ctx.carrier.id, gone as unknown as Item);
    await addActivity(ctx.carrier.id, event({ type: "negotiation_email", loadId: load.id, message: `You passed on ${load.referenceNumber}`, detail: broker?.company, severity: "info" }));
    return { done: "pass", note: "Sent the broker a polite pass." };
  }

  if (amount) {
    if (load.stage === "offered") {
      await requestBooking(ctx, load, amount, { byOwner: true });
      return { done: "ask", amount, note: `Asked to book it at $${amount.toLocaleString()}.${under}` };
    }
    if (!to) return { error: "no_broker_email" };
    const at = new Date().toISOString();
    const req = load.bookRequest ?? { ask: amount, askedAt: at, status: "sent" as const };
    const updated: Load = addWhy(
      { ...load, targetRate: amount, updatedAt: at, bookRequest: { ...req, ask: amount, rounds: (req.rounds ?? 0) + 1, history: [...(req.history ?? []), { by: "us", amount, at, via: "email" }] } },
      `You countered at $${amount.toLocaleString()}.${under}`,
    );
    await save("loads", ctx.carrier.id, updated as unknown as Item);
    ctx.loads = ctx.loads.map((l) => (l.id === updated.id ? updated : l));
    await sendOrQueue(ctx, { purpose: "counter", to, toName: name, subject, body: mail.counter(ctx.carrier, ctx.settings, updated, amount, name, { final: false }), loadId: load.id, amount, withinRules: true, ownerAsked: true, why: `You asked to counter at $${amount.toLocaleString()}.` });
    return { done: "counter", amount, note: `Countered at $${amount.toLocaleString()}.${under}` };
  }

  if (!to) return { error: "no_broker_email" };
  const line = await relayLine(text);
  const body = `Hi${name ? ` ${name}` : ""},\n\n${line}\n\nThanks,\n${ctx.carrier.name}`;
  await sendOrQueue(ctx, { purpose: "reply", to, toName: name, subject, body, loadId: load.id, withinRules: true, ownerAsked: true, why: "You asked the AI to send this." });
  return { done: "relay", note: `Sent: "${line}"` };
}
