import { dbConfigured } from "@/lib/agent/db";
import { supportCaller } from "@/lib/agent/support";
import { healthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Every part of the system and how it's doing, for the support console's System tab. */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  if (!(await supportCaller(request))) return Response.json({ error: "support_only" }, { status: 403 });
  return Response.json({ checks: await healthReport(), at: new Date().toISOString() });
}
