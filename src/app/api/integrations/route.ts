import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { applyEld, EldError, readEld } from "@/lib/agent/eld";
import { FeedError, readFeed } from "@/lib/agent/feeds";
import { integrationsFor, removeIntegration, saveIntegration, type FeedConfig } from "@/lib/agent/integrations";
import { caller } from "@/lib/agent/user";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["samsara", "motive"]), apiKey: z.string().trim().min(8).max(500) }),
  z.object({
    kind: z.literal("load_feed"),
    url: z.string().url().max(2000).refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", "https only"),
    format: z.enum(["json", "csv"]),
    headerName: z.string().trim().max(100).optional(),
    headerValue: z.string().trim().max(2000).optional(),
    name: z.string().trim().max(60).optional(),
  }),
]);

/** What's connected (never the keys themselves). Office only. */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const rows = await integrationsFor(who.me.carrierId);
  return Response.json({
    connections: rows.map((r) => ({
      kind: r.kind,
      status: r.status,
      checkedAt: r.checked_at,
      ...(r.kind === "load_feed" ? { name: (r.config as FeedConfig).name ?? null, host: new URL((r.config as FeedConfig).url).host } : {}),
    })),
  });
}

/** Connect (or replace) an ELD or a load feed. It's tried right away, and only saved if it works. */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", reason: "Check the address and the key." }, { status: 400 });
  const b = parsed.data;
  try {
    if (b.kind === "load_feed") {
      const cfg: FeedConfig = { url: b.url, format: b.format, headerName: b.headerName || undefined, headerValue: b.headerValue || undefined, name: b.name || "Load feed" };
      const rows = await readFeed(cfg);
      const status = `Connected · ${rows.length} usable load${rows.length === 1 ? "" : "s"} in it now`;
      await saveIntegration(who.me.carrierId, "load_feed", cfg, status);
      return Response.json({ ok: true, status });
    }
    const data = await readEld(b.kind, b.apiKey);
    const ctx = await loadContext(who.me.carrierId);
    const applied = ctx ? await applyEld(ctx, b.kind, data) : { trucks: 0, drivers: 0, unmatched: [] };
    const status = `Connected · ${applied.trucks} truck${applied.trucks === 1 ? "" : "s"} and ${applied.drivers} driver${applied.drivers === 1 ? "" : "s"} matched${applied.unmatched.length ? `; not matched: ${applied.unmatched.slice(0, 5).join(", ")}` : ""}`;
    await saveIntegration(who.me.carrierId, b.kind, { apiKey: b.apiKey }, status);
    return Response.json({ ok: true, status });
  } catch (e) {
    const reason = e instanceof EldError || e instanceof FeedError ? e.message : "Couldn't connect.";
    return Response.json({ ok: false, reason }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const kind = z.enum(["samsara", "motive", "load_feed"]).safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return Response.json({ error: "bad_request" }, { status: 400 });
  await removeIntegration(who.me.carrierId, kind.data);
  return Response.json({ ok: true });
}
