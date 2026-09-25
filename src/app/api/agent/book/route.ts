import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { requestBooking } from "@/lib/agent/booking";
import { askFor, floorFor } from "@/lib/agent/pricing";
import { caller } from "@/lib/agent/user";
import { emailConfigured } from "@/lib/channels/email";

const Body = z.object({ loadId: z.string().min(1), ask: z.number().positive().max(100000).optional() });

/**
 * The owner picked a load offered by email: the AI asks the broker to book it, at the price the rules give or the
 * one the owner typed. Their tap is the approval, so it goes now.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!emailConfigured()) return Response.json({ error: "email_off" }, { status: 503 });

  const ctx = await loadContext(who.me.carrierId);
  const load = ctx?.loads.find((l) => l.id === parsed.data.loadId);
  if (!ctx || !load) return Response.json({ error: "not_found" }, { status: 404 });
  if (load.stage !== "offered") return Response.json({ error: "not_offered" }, { status: 409 });
  // The price the owner saw on the offer, unless the lowest rate was raised since: never under the floor.
  const floor = floorFor(load, ctx.settings) ?? 0;
  const ask = parsed.data.ask ?? (load.targetRate > 0 ? Math.max(load.targetRate, floor) : askFor(load, ctx.settings));
  if (!ask) return Response.json({ error: "need_price" }, { status: 422 });

  await requestBooking(ctx, load, ask, { byOwner: true });
  const changed = ctx.loads.filter((l) => l.offerGroupId === load.offerGroupId || l.id === load.id);
  return Response.json({ loads: changed });
}
