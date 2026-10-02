import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, FALLBACK, authorize, claude, deny, json } from "@/lib/ai/server";
import { DRIVER_SYSTEM, OWNER_SYSTEM, READ_ONLY } from "@/lib/ai/prompts";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { driverTurn, ownerTurn } from "@/lib/agent/dispatcher";
import { forCarrier } from "@/lib/agent/scope";
import { caller } from "@/lib/agent/user";

const Body = z.object({
  role: z.enum(["owner", "driver"]),
  question: z.string().trim().min(1).max(2000),
  /** Earlier messages in this thread, oldest first. */
  history: z.array(z.object({ from: z.enum(["user", "ai"]), text: z.string().max(4000) })).max(20),
  /** The fleet data this person may see, built in their browser from what their account already loaded. */
  snapshot: z.record(z.string(), z.unknown()),
});

/**
 * A message from the owner's "Ask the AI" or a driver's Messages tab. On a real account it goes to the same AI as
 * texts and calls, which can act (mark a load, report a problem, find parking, answer what's waiting); in the demo
 * it answers from the data the browser sent.
 */
export async function POST(request: Request) {
  const access = await authorize(request);
  if (!access.ok) return deny(access);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const { role, question, history, snapshot } = parsed.data;

  // A real account: the same AI as texts and calls, with its tools, working from the carrier's own records.
  const who = dbConfigured() ? await caller(request) : null;
  if (who) {
    const ctx = await loadContext(who.me.carrierId);
    if (!ctx) return json({ error: "not_found" }, 404);
    const turns = history.map((m) => ({ from: m.from === "user" ? ("them" as const) : ("ai" as const), text: m.text }));
    const driver = who.me.role === "driver" ? ctx.drivers.find((d) => d.id === who.me.driverId) : undefined;
    if (who.me.role === "driver" && !driver) return json({ error: "not_found" }, 404);
    // The AI acts on what it's told (books, counters, texts drivers): that's the owner's and dispatchers' to ask.
    if (who.me.role === "bookkeeper") return json({ error: "owner_only" }, 403);
    const result = await forCarrier(ctx.carrier.id, () => (driver ? driverTurn(ctx, driver, "chat", question, turns) : ownerTurn(ctx, "chat", question, turns)));
    if (result.effects.failed || !result.reply) return json({ error: "ai_error" }, 502);
    return json({ reply: result.reply, who: access.who, did: result.effects.done });
  }

  const data = JSON.stringify(snapshot);
  if (data.length > 60_000) return json({ error: "too_large" }, 413);

  const turns: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.text }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  turns.push({
    role: "user",
    content: [
      { type: "text", text: `Fleet data right now (${new Date().toUTCString()}):\n${data}` },
      { type: "text", text: question },
    ],
  });

  try {
    const response = await claude().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      ...FALLBACK,
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: role === "owner" ? OWNER_SYSTEM : DRIVER_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: READ_ONLY },
      ],
      messages: turns,
    });
    if (response.stop_reason === "refusal") return json({ error: "declined" }, 422);
    const reply = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!reply) return json({ error: "empty" }, 502);
    return json({ reply, who: access.who });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (error instanceof Anthropic.APIError) return json({ error: "ai_error", status: error.status }, 502);
    return json({ error: "unreachable" }, 502);
  }
}
