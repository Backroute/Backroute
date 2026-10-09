import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { validVoiceToken } from "@/lib/channels/realtime";
import { callTurn } from "@/lib/channels/turn";
import { hasBearer } from "@/lib/bearer";

export const maxDuration = 30;

const Body = z.object({
  kind: z.enum(["driver", "broker", "shop", "owner", "facility"]),
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
  if (!hasBearer(request, process.env.VOICE_SERVER_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  if (!validVoiceToken(b.kind, b.carrier, b.ref, b.callSid, b.token)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await loadContext(b.carrier);
  if (!ctx) return Response.json({ reply: "Sorry, I can't find your account. Please call your carrier.", hangUp: true });
  return Response.json(await callTurn(ctx, b.kind, b.ref, b.callSid, b.said, { realtime: true }));
}
