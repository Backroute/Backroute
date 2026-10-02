import { z } from "zod";
import { dbConfigured } from "@/lib/agent/db";
import { heldFor, stop } from "@/lib/agent/held";
import { caller } from "@/lib/agent/user";

/**
 * What the AI is about to send (GET) and stopping one before it goes (POST {id}). The owner or a dispatcher only
 * (lib/agent/held).
 */
async function office(request: Request) {
  if (!dbConfigured()) return { error: Response.json({ error: "not_set_up" }, { status: 503 }) };
  const who = await caller(request);
  if (!who || who.me.role === "driver") return { error: Response.json({ error: "sign_in" }, { status: 401 }) };
  return { who };
}

export async function GET(request: Request) {
  const o = await office(request);
  if (o.error) return o.error;
  return Response.json({ held: await heldFor(o.who.me.carrierId) });
}

const Body = z.object({ id: z.string().regex(/^hs_[0-9a-f]{16}$/) });

export async function POST(request: Request) {
  const o = await office(request);
  if (o.error) return o.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const r = await stop(o.who.me.carrierId, parsed.data.id, o.who.me.userId);
  return r.stopped ? Response.json({ ok: true, note: r.note }) : Response.json({ error: "already_sent" }, { status: 409 });
}
