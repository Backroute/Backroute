import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { applyEld, EldError, readEld } from "@/lib/agent/eld";
import { FeedError, readFeed } from "@/lib/agent/feeds";
import { integrationsFor, removeIntegration, saveIntegration, type CustomBoardConfig, type FeedConfig, type IntegrationKind, type TruckstopConfig } from "@/lib/agent/integrations";
import { boardFor } from "@/lib/agent/boards";
import { datConfigured } from "@/lib/agent/boards/dat";
import { truckstopConfigured } from "@/lib/agent/boards/truckstop";
import { BoardError } from "@/lib/agent/boards/types";
import { caller } from "@/lib/agent/user";

const Custom = z.object({
  name: z.string().trim().min(2).max(40),
  searchUrl: z.string().url().max(2000),
  method: z.enum(["GET", "POST"]),
  headers: z.record(z.string(), z.string().max(2000)).optional(),
  body: z.string().max(5000).optional(),
  listPath: z.string().max(200),
  fields: z.record(z.string(), z.string().max(200)),
});

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("truckstop"), integrationId: z.string().trim().min(1).max(40), postTrucks: z.boolean().optional() }),
  z.object({ kind: z.literal("dat"), userEmail: z.string().trim().email().max(200), postTrucks: z.boolean().optional() }),
  z.object({ kind: z.literal("board"), config: Custom }),
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
    // Whether Backroute's own side of each board is in place (its partner agreement and login).
    available: { truckstop: truckstopConfigured(), dat: datConfigured() },
    connections: rows.map((r) => ({
      kind: r.kind,
      status: r.status,
      checkedAt: r.checked_at,
      ...(r.kind === "load_feed" ? { name: (r.config as FeedConfig).name ?? null, host: new URL((r.config as FeedConfig).url).host } : {}),
      ...(r.kind.startsWith("board:") ? { name: (r.config as CustomBoardConfig).name } : {}),
      ...(r.kind === "truckstop" || r.kind === "dat" ? { postTrucks: !!(r.config as TruckstopConfig).postTrucks } : {}),
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
    if (b.kind === "truckstop" || b.kind === "dat" || b.kind === "board") {
      const kind = b.kind === "board" ? (`board:${b.config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}` as const) : b.kind;
      const config = b.kind === "truckstop" ? { integrationId: b.integrationId, postTrucks: !!b.postTrucks } : b.kind === "dat" ? { userEmail: b.userEmail, postTrucks: !!b.postTrucks } : b.config;
      const row = { carrier_id: who.me.carrierId, kind, config, status: null, checked_at: null };
      const board = boardFor(row);
      if (!board) {
        // The carrier's side is saved; searching starts when Backroute's agreement with the board is in place.
        const status = "Saved · waiting on Backroute's agreement with this board";
        await saveIntegration(who.me.carrierId, kind, config, status);
        return Response.json({ ok: true, status });
      }
      // A test search from where the carrier's first truck is, so a wrong ID shows now rather than later.
      const ctx = await loadContext(who.me.carrierId);
      const truck = ctx?.trucks.find((t) => t.currentCity && t.currentState);
      const found = truck ? await board.search({ originCity: truck.currentCity, originState: truck.currentState, radius: 150, availableFrom: new Date().toISOString(), equipment: truck.equipmentType }) : [];
      const status = `Connected · test search found ${found.length} load${found.length === 1 ? "" : "s"} near ${truck?.currentCity ?? "your trucks"}`;
      await saveIntegration(who.me.carrierId, kind, config, status);
      return Response.json({ ok: true, status });
    }
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
    const reason = e instanceof EldError || e instanceof FeedError || e instanceof BoardError ? e.message : "Couldn't connect.";
    return Response.json({ ok: false, reason }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const kind = z.union([z.enum(["samsara", "motive", "load_feed", "truckstop", "dat"]), z.string().regex(/^board:[a-z0-9_-]{1,40}$/)]).safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return Response.json({ error: "bad_request" }, { status: 400 });
  await removeIntegration(who.me.carrierId, kind.data as IntegrationKind);
  return Response.json({ ok: true });
}
