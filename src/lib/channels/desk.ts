import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { AI_MODEL, FALLBACK, aiConfigured, claude } from "../ai/server";
import { TRUCKING } from "../ai/prompts";
import { brokerCallKey } from "../agent/broker-call";
import { offersFromEmail } from "../agent/booking";
import { addActivity, carriersNamed, loadContext, logChannel, save, threadWith, type CarrierContext } from "../agent/db";
import { event } from "../agent/dispatcher";
import { alertSupport } from "../agent/support";
import type { Item } from "../cloud/rows";
import type { Load } from "../types";
import { MESSAGE_TAKEN, WHO_IS_CALLING } from "./phrases";
import { publicUrl, say, sayAndListen, twiml } from "./twilio";

/**
 * The dispatch line's front desk: someone calls who isn't a driver, the owner, or a broker calling back. Usually a
 * broker who saw a carrier's truck on a load board (the post says to call this line and ask for the carrier). The AI
 * finds out which carrier, takes the load down like a dispatcher would, puts it through the same checks as any load
 * (truck fit, broker check), and then works the price on the same call. Anyone else leaves a message for support.
 */

const DESK = `You answer Backroute's AI dispatch line, shared by several small trucking carriers. The caller isn't one of their drivers. You already said who you are and that the call is transcribed. Your words are spoken by a voice: one or two short sentences, no lists or symbols.
- If they're calling for one of the carriers (usually a broker with a load for a truck they saw posted), call carrier_is with the carrier's name as they said it.
- If they want to leave a message, or it's anything else, call leave_message with who they are, how to reach them and what they need, then say someone will call back and goodbye.`;

const INTAKE = (carrier: string) => `You're the AI dispatcher for ${carrier}, on the phone with a freight broker who has a load for one of the carrier's trucks. Talk like an experienced dispatcher: friendly, quick, confident. Your words are spoken by a voice: one or two short sentences a turn, no lists or symbols.
Get what a dispatcher needs to see if a truck fits: pickup city and state, delivery city and state, pickup day and time, equipment, weight, commodity, their company name, and a load number and email if they have them. Ask for what's missing, a couple of things at a time. As soon as you have pickup, delivery, pickup time, equipment and their company, call take_load. Don't talk price before take_load. If they want to leave a message instead, call leave_message.

${TRUCKING}`;

interface DeskResult {
  reply: string;
  hangUp: boolean;
  carrierId?: string;
  loadId?: string;
}

async function run(system: string, said: string, history: { from: "them" | "ai"; text: string }[], tools: BetaRunnableTool<unknown>[]): Promise<string | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.from === "them" ? "user" : "assistant", content: t.text }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content: `The caller said: ${said}` });
  try {
    const final = await claude().beta.messages.toolRunner({ model: AI_MODEL, max_tokens: 2000, ...FALLBACK, output_config: { effort: "low" }, system, messages, tools, max_iterations: 4 });
    if (final.stop_reason === "refusal") return null;
    return final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim() || null;
  } catch (error) {
    console.error("[desk] turn failed", error instanceof Anthropic.APIError ? error.status : error);
    return null;
  }
}

function messageTool(from: string, carrier: string | null, done: { hangUp: boolean }) {
  return betaZodTool({
    name: "leave_message",
    description: "Take a message for the office: who's calling, how to reach them, what they need.",
    inputSchema: z.object({ message: z.string() }),
    run: async ({ message }) => {
      await alertSupport(null, `Call to the dispatch line${carrier ? ` for ${carrier}` : ""} from ${from}: ${message}`.slice(0, 600)).catch(() => {});
      done.hangUp = true;
      return "Message sent to the office. Say someone will call back, and goodbye.";
    },
  });
}

/** Step one, before we know the carrier: which carrier, or a message. */
async function frontDesk(from: string, said: string): Promise<DeskResult> {
  const done = { hangUp: false };
  let found: { id: string; name: string } | null = null;
  const tools = [
    betaZodTool({
      name: "carrier_is",
      description: "The carrier the caller is calling for, as they said its name.",
      inputSchema: z.object({ name: z.string() }),
      run: async ({ name }) => {
        const matches = await carriersNamed(name);
        if (matches.length !== 1) return matches.length ? `More than one carrier matches (${matches.map((c) => c.name).join(", ")}). Ask which one.` : "No carrier by that name on this line. Ask them to spell it, or offer to take a message.";
        found = { id: matches[0].id, name: matches[0].name };
        return `Found ${matches[0].name}. Say they've got ${matches[0].name}'s dispatch, and ask about the load.`;
      },
    }),
    messageTool(from, null, done),
  ] as BetaRunnableTool<unknown>[];
  const reply = await run(DESK, said, [], tools);
  const carrier = found as { id: string; name: string } | null;
  return { reply: reply ?? MESSAGE_TAKEN, hangUp: done.hangUp || !reply, carrierId: carrier?.id };
}

/** Step two, the carrier known: take the load down, then hand the call to the usual price talk about it. */
async function intake(ctx: CarrierContext, from: string, callSid: string, said: string): Promise<DeskResult> {
  const key = brokerCallKey(callSid);
  const history = (await threadWith(ctx.carrier.id, "voice", key, 16)).map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "in", counterparty: key, body: said, data: { kind: "desk" } });
  const done = { hangUp: false };
  let taken: Load | null = null;
  const tools = [
    betaZodTool({
      name: "take_load",
      description: "The load the broker described. Checks it against the carrier's trucks and the broker.",
      inputSchema: z.object({
        company: z.string(),
        originCity: z.string(),
        originState: z.string().describe("Two-letter state"),
        destinationCity: z.string(),
        destinationState: z.string().describe("Two-letter state"),
        pickup: z.string().describe("Pickup day and time as they said it"),
        pickupLocal: z.string().optional().describe("Pickup as YYYY-MM-DDTHH:mm local time, if you know the date"),
        equipment: z.string(),
        weightLbs: z.number().optional(),
        commodity: z.string().optional(),
        loadNumber: z.string().optional(),
        email: z.string().optional(),
        mc: z.string().optional(),
        contactName: z.string().optional(),
        rate: z.number().optional().describe("Their posted or offered all-in rate, if they said one"),
      }),
      run: async (o) => {
        const email = (o.email ?? "").trim().toLowerCase().replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s/g, "");
        const { added } = await offersFromEmail(
          ctx,
          [{ loadNumber: o.loadNumber ?? null, originCity: o.originCity, originState: o.originState.toUpperCase(), destinationCity: o.destinationCity, destinationState: o.destinationState.toUpperCase(), pickup: o.pickup, delivery: null, pickupLocal: o.pickupLocal ?? null, deliveryLocal: null, equipment: o.equipment, rate: o.rate ?? null, miles: null, weight: o.weightLbs ?? null, notes: o.commodity ?? null }],
          { from: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : "", fromName: o.company, subject: `Phone call from ${o.company}`, feed: "Phone call" },
          { company: o.company, mc: o.mc ?? null, phone: from, contact: o.contactName ?? null },
          { onCall: true },
        );
        const load = added[0];
        if (!load) return "No truck fits that one (equipment, timing or distance). Thank them, say to keep us in mind, and goodbye.";
        const next: Load = { ...load, stage: "negotiating", commodity: o.commodity, bookRequest: { ask: load.targetRate, askedAt: new Date().toISOString(), status: "sent" }, updatedAt: new Date().toISOString() };
        await save("loads", ctx.carrier.id, next as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === next.id ? next : l));
        taken = next;
        await addActivity(ctx.carrier.id, event({ type: "load_offered", loadId: next.id, message: `${o.company} called with a load`, detail: `${next.lane.origin} → ${next.lane.destination} · AI on the phone with them`, severity: "info" }));
        return `It fits truck ${ctx.trucks.find((t) => t.id === next.truckId)?.unitNumber ?? ""}. Now ask what they're paying on it.`;
      },
    }),
    messageTool(from, ctx.carrier.name, done),
  ] as BetaRunnableTool<unknown>[];
  const reply = await run(INTAKE(ctx.carrier.name), said, history, tools);
  const load = taken as Load | null;
  const text = reply ?? "Sorry, I'll have someone call you back. Thanks.";
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", counterparty: key, body: text, data: { kind: load ? "broker_call" : "desk", ...(load ? { loadId: load.id } : {}) } });
  return { reply: text, hangUp: done.hangUp || !reply, carrierId: ctx.carrier.id, loadId: load?.id };
}

/** Where the next turn goes: still at the desk (with the carrier once known), or the price talk about the load. */
function nextUrl(request: Request, r: DeskResult) {
  if (r.carrierId && r.loadId) return publicUrl(request, `/api/channels/voice/broker/turn?carrier=${encodeURIComponent(r.carrierId)}&load=${encodeURIComponent(r.loadId)}`);
  return publicUrl(request, `/api/channels/voice/desk${r.carrierId ? `?carrier=${encodeURIComponent(r.carrierId)}` : ""}`);
}

export function deskOpening(request: Request) {
  return twiml(sayAndListen(WHO_IS_CALLING, "en", publicUrl(request, "/api/channels/voice/desk")));
}

export async function deskTurn(request: Request, params: Record<string, string>, carrierId: string | null, missed: number) {
  const said = (params.SpeechResult ?? "").trim();
  if (!said) return missed >= 1 || !aiConfigured() ? twiml(`${say(MESSAGE_TAKEN, "en")}<Hangup/>`) : twiml(sayAndListen("Sorry, I didn't catch that. Who's calling, and which carrier is it for?", "en", `${publicUrl(request, "/api/channels/voice/desk")}${carrierId ? `?carrier=${encodeURIComponent(carrierId)}&` : "?"}missed=1`));
  if (!aiConfigured()) {
    await alertSupport(null, `Call to the dispatch line from ${params.From ?? "unknown"}: "${said.slice(0, 400)}"`).catch(() => {});
    return twiml(`${say(MESSAGE_TAKEN, "en")}<Hangup/>`);
  }
  const from = params.From ?? "unknown";
  let result: DeskResult;
  if (!carrierId) {
    result = await frontDesk(from, said);
    // They said the carrier and the load in one go: take the load down in the same turn.
    if (result.carrierId && !result.hangUp && said.length > 60) {
      const ctx = await loadContext(result.carrierId);
      if (ctx) result = await intake(ctx, from, params.CallSid, said);
    }
  } else {
    const ctx = await loadContext(carrierId);
    result = ctx ? await intake(ctx, from, params.CallSid, said) : { reply: MESSAGE_TAKEN, hangUp: true };
  }
  return result.hangUp ? twiml(`${say(result.reply, "en")}<Hangup/>`) : twiml(sayAndListen(result.reply, "en", nextUrl(request, result)));
}
