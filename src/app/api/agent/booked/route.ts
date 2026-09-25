import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { bookIt } from "@/lib/agent/booking";
import { caller } from "@/lib/agent/user";

const Body = z.object({ loadId: z.string().min(1), rate: z.number().positive().max(100000).optional() });

/** The owner says the broker confirmed: the load goes on its truck and the driver gets the text. */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const ctx = await loadContext(who.me.carrierId);
  const load = ctx?.loads.find((l) => l.id === parsed.data.loadId);
  if (!ctx || !load) return Response.json({ error: "not_found" }, { status: 404 });
  if (load.stage !== "negotiating" && load.stage !== "offered") return Response.json({ error: "not_pending" }, { status: 409 });
  const { load: booked, truck } = await bookIt(ctx, load, parsed.data.rate);
  return Response.json({ loads: [booked], trucks: truck ? [truck] : [] });
}
