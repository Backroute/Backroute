import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, claude } from "./server";

/**
 * For the simulated brokers and drivers (eval/sim.mjs): the AI plays the other side of a conversation with the
 * dispatcher, in character, with facts only it knows (the most a broker will pay, how late the driver really is);
 * then a judge reads the whole conversation the way a veteran dispatcher would. Never used for a real carrier.
 */

export interface Line {
  from: "them" | "ai";
  text: string;
}

export interface Partner {
  role: "broker" | "driver" | "owner" | "shop" | "facility";
  channel: "email" | "sms" | "call";
  /** Who they are and how they talk. */
  persona: string;
  /** What only they know, and how they behave (limits, moves, the truth behind what they say). */
  secret: string;
  language?: string;
}

const Move = z.object({
  message: z.string().describe("What you say or write next, exactly as you'd send it. Empty when you have nothing more to say."),
  done: z.boolean().describe("True when the conversation is over for you: the deal is done, you walked away, or you hung up."),
});

const WHO: Record<Partner["role"], string> = {
  broker: "a freight broker at a US brokerage",
  driver: "a truck driver working for a small trucking company",
  owner: "the owner of a small trucking company",
  shop: "someone at a truck repair shop or towing company",
  facility: "the scheduler at a warehouse's shipping or receiving office, who books dock appointments",
};

const HOW: Record<Partner["channel"], string> = {
  email: "You're writing emails: short, the way brokers really write them, no pleasantries beyond a line, sign with your first name.",
  sms: "You're texting: short, casual, sometimes typos or abbreviations, no signature.",
  call: "You're on the phone: one or two short spoken sentences per turn, the way people really talk on a call, no stage directions.",
};

export async function playPartner(p: Partner, transcript: Line[]): Promise<{ message: string; done: boolean } | null> {
  const system = `You are playing ${WHO[p.role]} in a test of an AI dispatcher. Stay fully in character; never mention the test or that you're an AI.

Who you are: ${p.persona}

What only you know, and how you behave (never say these outright unless it's natural to): ${p.secret}

${HOW[p.channel]}${p.language && p.language !== "en" ? ` Write in ${p.language}.` : ""}

The other side is the dispatcher for a carrier. Push back the way a real person like you would. If they say something confusing, wrong or unprofessional, react the way a real person would. Keep going until it's naturally over.`;
  const content = transcript.length ? transcript.map((l) => `${l.from === "them" ? "YOU" : "DISPATCHER"}: ${l.text}`).join("\n\n") + "\n\nYour turn." : "Start the conversation.";
  try {
    const res = await claude().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 2000,
      ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(Move) },
      system,
      messages: [{ role: "user", content }],
    });
    return res.parsed_output ?? null;
  } catch (e) {
    console.error("[sim] partner failed", e);
    return null;
  }
}

const Verdict = z.object({
  human: z.number().int().min(1).max(5).describe("How much the dispatcher sounded like a good human dispatcher: 1 robotic or odd, 5 indistinguishable from a great one."),
  handled: z.boolean().describe("Whether the dispatcher handled the situation the way a good dispatcher would."),
  mistakes: z.array(z.string()).describe("Each concrete mistake: wrong facts, a bad promise, money left on the table, missed questions, rudeness, the wrong language. Empty if none."),
  better: z.string().describe("In one or two sentences, what a veteran dispatcher would have done differently. Empty if nothing."),
});
export type SimVerdict = z.infer<typeof Verdict>;

export async function judge(situation: string, expectations: string[], transcript: Line[], outcome: string): Promise<SimVerdict | null> {
  const system = `You are a veteran US truck dispatcher with 20 years of experience, reviewing how an AI dispatcher handled a conversation. Be strict and specific, the way you'd coach a new dispatcher. Judge only what the dispatcher (DISPATCHER lines) did.`;
  const content = `Situation: ${situation}

A good dispatcher would: ${expectations.map((e) => `\n- ${e}`).join("")}

Conversation:
${transcript.map((l) => `${l.from === "them" ? "OTHER SIDE" : "DISPATCHER"}: ${l.text}`).join("\n\n")}

What happened in the system afterwards: ${outcome}`;
  try {
    const res = await claude().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 3000,
      ...FALLBACK,
      output_config: { effort: "medium", format: betaZodOutputFormat(Verdict) },
      system,
      messages: [{ role: "user", content }],
    });
    return res.parsed_output ?? null;
  } catch (e) {
    console.error("[sim] judge failed", e);
    return null;
  }
}
