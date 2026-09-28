import { admin, dbConfigured } from "@/lib/agent/db";

export const dynamic = "force-dynamic";

/** For uptime monitors: 200 when the app and its database answer, 503 when not. Nothing else is said here. */
export async function GET() {
  if (!dbConfigured()) return Response.json({ ok: false }, { status: 503 });
  const { error } = await admin().from("carriers").select("id", { head: true }).limit(1);
  return Response.json({ ok: !error }, { status: error ? 503 : 200, headers: { "cache-control": "no-store" } });
}
