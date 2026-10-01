import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { ownerInstruction } from "@/lib/agent/instruct";
import { caller } from "@/lib/agent/user";
import { canEmail } from "@/lib/channels/out";

const Body = z.object({ loadId: z.string().min(1), text: z.string().trim().min(2).max(500) });

/** The owner's instruction on a negotiation, done for real (lib/agent/instruct). The owner or a dispatcher only. */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const ctx = await loadContext(who.me.carrierId);
  const load = ctx?.loads.find((l) => l.id === parsed.data.loadId);
  if (!ctx || !load) return Response.json({ error: "not_found" }, { status: 404 });
  if (!["offered", "negotiating"].includes(load.stage)) return Response.json({ error: "not_negotiating" }, { status: 409 });
  if (!canEmail(ctx.carrier)) return Response.json({ error: "email_off" }, { status: 503 });
  const result = await ownerInstruction(ctx, load, parsed.data.text);
  if ("error" in result) return Response.json(result, { status: 422 });
  return Response.json({ ...result, load: ctx.loads.find((l) => l.id === load.id) });
}
