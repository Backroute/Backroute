import { z } from "zod";
import { aiConfigured } from "@/lib/ai/server";
import { readBrokerEmail } from "@/lib/agent/broker-mail";
import { brokerCallTurn } from "@/lib/agent/broker-call";
import type { CarrierContext } from "@/lib/agent/db";
import { driverTurn } from "@/lib/agent/dispatcher";
import { generateWorld, PRIMARY_CARRIER_ID, PRIMARY_DRIVER_ID } from "@/lib/mock-data";
import type { AgentSettings } from "@/lib/store";
import type { Lang } from "@/lib/types";
import { hasBearer } from "@/lib/bearer";

export const maxDuration = 60;

const Body = z.object({
  kind: z.enum(["driver", "broker", "email"]),
  text: z.string().min(1).max(4000),
  subject: z.string().max(300).optional(),
  lang: z.enum(["en", "es", "pa", "hi", "ru", "uk", "fr"]).optional(),
});

/**
 * For measuring how well the AI understands people (eval/run.mjs): one message, answered by the real AI against the
 * demo fleet, with its tools switched to dry run so nothing is saved or sent. Returns what it said and the tools it
 * picked. Off unless EVAL_SECRET is set, and only with that secret.
 */
export async function POST(request: Request) {
  if (!hasBearer(request, process.env.EVAL_SECRET)) return new Response("Not found", { status: 404 });
  if (!aiConfigured()) return Response.json({ error: "ai_off" }, { status: 503 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { kind, text, subject, lang } = parsed.data;

  if (kind === "email") {
    const reading = await readBrokerEmail(subject ?? "Load", text);
    return Response.json({ reading });
  }

  const world = generateWorld();
  const ctx: CarrierContext = {
    carrier: { id: PRIMARY_CARRIER_ID, name: "Titan Freight LLC", mc: "548213", owner_operator: false, owner_phone: null, inbound_key: "eval", settings: {} },
    settings: { autonomy: "rules", minRpm: 2.5, ownerLanguage: "en", rateFloorPct: 0, ownerOperator: false, dailyText: false } as unknown as AgentSettings,
    drivers: world.drivers.filter((d) => d.carrierId === PRIMARY_CARRIER_ID),
    trucks: world.trucks.filter((t) => t.carrierId === PRIMARY_CARRIER_ID),
    loads: world.loads.filter((l) => l.carrierId === PRIMARY_CARRIER_ID),
    escalations: [],
    brokers: world.brokers,
  };
  const picked: { tool: string; input: unknown }[] = [];
  if (kind === "driver") {
    const base = ctx.drivers.find((d) => d.id === PRIMARY_DRIVER_ID) ?? ctx.drivers[0];
    const driver = { ...base, prefs: { ...base.prefs, language: (lang ?? "en") as Lang } };
    const result = await driverTurn(ctx, driver, "sms", text, [], picked);
    return Response.json({ reply: result.reply, tools: picked, failed: !!result.effects.failed });
  }
  const load = ctx.loads.find((l) => l.stage === "negotiating") ?? ctx.loads.find((l) => l.stage === "offered") ?? ctx.loads[0];
  const result = await brokerCallTurn(ctx, { ...load, bookRequest: { ask: load.targetRate, askedAt: new Date().toISOString(), status: "sent" } }, text, [], picked);
  return Response.json({ reply: result.reply, tools: picked, failed: !!result.failed });
}
