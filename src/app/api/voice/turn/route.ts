import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { brokerCallReply } from "@/lib/agent/broker-call";
import { shopCallReply } from "@/lib/agent/roadside";
import { validVoiceToken } from "@/lib/channels/realtime";
import { driverCallReply, ownerCallReply } from "@/lib/channels/voice";

export const maxDuration = 30;

const Body = z.object({
  kind: z.enum(["driver", "broker", "shop", "owner"]),
  carrier: z.string().min(1),
  ref: z.string().min(1),
  callSid: z.string().min(1),
  token: z.string().min(1),
  said: z.string().trim().min(1).max(2000),
});

/**
 * The voice server's side of a natural call: what the caller just said, and what the AI says back (and whether the
 * call is over). The same AI, tools and rules as the turn-by-turn calls. Only the voice server can call it: it signs
 * with VOICE_SERVER_SECRET, and each call's parameters carry their own signature from when the app answered it.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const secret = process.env.VOICE_SERVER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  if (!validVoiceToken(b.kind, b.carrier, b.ref, b.callSid, b.token)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await loadContext(b.carrier);
  if (!ctx) return Response.json({ reply: "Sorry, I can't find your account. Please call your carrier.", hangUp: true });
  if (b.kind === "driver") {
    const driver = ctx.drivers.find((d) => d.id === b.ref);
    if (!driver) return Response.json({ reply: "Sorry, I can't find you on file. Please call your carrier.", hangUp: true });
    return Response.json(await driverCallReply(b.carrier, driver, b.callSid, b.said, { realtime: true }));
  }
  if (b.kind === "owner") return Response.json(await ownerCallReply(b.carrier, b.callSid, b.said, { realtime: true }));
  if (b.kind === "broker") {
    const load = ctx.loads.find((l) => l.id === b.ref);
    if (!load) return Response.json({ reply: "Sorry, I'll follow up by email. Thanks.", hangUp: true });
    return Response.json(await brokerCallReply(ctx, load, b.callSid, b.said, { realtime: true }));
  }
  const truck = ctx.trucks.find((t) => t.id === b.ref);
  if (!truck?.roadside) return Response.json({ reply: "Sorry, wrong number. Thanks.", hangUp: true });
  return Response.json(await shopCallReply(ctx, truck, b.callSid, b.said));
}
