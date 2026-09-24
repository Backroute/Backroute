import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, FALLBACK, authorize, claude, deny, json } from "@/lib/ai/server";
import { DRIVER_SYSTEM, OWNER_SYSTEM } from "@/lib/ai/prompts";

const Body = z.object({
  role: z.enum(["owner", "driver"]),
  question: z.string().trim().min(1).max(2000),
  /** Earlier messages in this thread, oldest first. */
  history: z.array(z.object({ from: z.enum(["user", "ai"]), text: z.string().max(4000) })).max(20),
  /** The fleet data this person may see, built in their browser from what their account already loaded. */
  snapshot: z.record(z.string(), z.unknown()),
});

/** A question from the owner's "Ask the AI" or a driver's Messages tab, answered from their own fleet data. */
export async function POST(request: Request) {
  const access = await authorize(request);
  if (!access.ok) return deny(access);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const { role, question, history, snapshot } = parsed.data;
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
      system: [{ type: "text", text: role === "owner" ? OWNER_SYSTEM : DRIVER_SYSTEM, cache_control: { type: "ephemeral" } }],
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
