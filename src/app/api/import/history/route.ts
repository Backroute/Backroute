import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { importHistory } from "@/lib/agent/history";
import { caller } from "@/lib/agent/user";

export const maxDuration = 60;

const Body = z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(false) });

/**
 * The owner's history spreadsheet: first a dry run that says what it found (which columns, how many loads and new
 * brokers, what it skipped and why), then the import. The owner or a dispatcher only.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const ctx = await loadContext(who.me.carrierId);
  if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    return Response.json(await importHistory(ctx, parsed.data.csv, { dryRun: parsed.data.dryRun }));
  } catch (e) {
    console.error("[import] history failed", e);
    return Response.json({ error: "import_failed" }, { status: 500 });
  }
}
