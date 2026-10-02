import { dbConfigured } from "@/lib/agent/db";
import { recentBatches, undoBatch, validBatchId } from "@/lib/agent/import-batches";
import { caller } from "@/lib/agent/user";

/**
 * The carrier's history imports (lib/agent/import-batches): GET lists the last 90 days, DELETE ?batch=… takes one
 * back out. The owner or a dispatcher only.
 */
async function office(request: Request) {
  if (!dbConfigured()) return { error: Response.json({ error: "not_set_up" }, { status: 503 }) };
  const who = await caller(request);
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return { error: Response.json({ error: "sign_in" }, { status: 401 }) };
  return { carrierId: who.me.carrierId };
}

export async function GET(request: Request) {
  const o = await office(request);
  if (o.error) return o.error;
  return Response.json({ batches: await recentBatches(o.carrierId) });
}

export async function DELETE(request: Request) {
  const o = await office(request);
  if (o.error) return o.error;
  const batch = new URL(request.url).searchParams.get("batch");
  if (!validBatchId(batch)) return Response.json({ error: "bad_request" }, { status: 400 });
  try {
    const undone = await undoBatch(o.carrierId, batch);
    return undone ? Response.json({ ok: true, ...undone }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch (e) {
    console.error("[import] undo failed", e);
    return Response.json({ error: "undo_failed" }, { status: 500 });
  }
}
