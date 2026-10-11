import type { MailboxConfig } from "@/lib/agent/mailbox";
import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { applyEld, EldError, readEld } from "@/lib/agent/eld";
import { FeedError, readFeed } from "@/lib/agent/feeds";
import { auditChange, integrationsFor, removeIntegration, saveIntegration, setStatus, type CustomBoardConfig, type EldConfig, type FeedConfig, type IntegrationKind, type StatementConfig, type TruckstopConfig } from "@/lib/agent/integrations";
import { boardFor } from "@/lib/agent/boards";
import { importStatementText, readStatement, StatementError } from "@/lib/agent/costs";
import { datConfigured } from "@/lib/agent/boards/dat";
import { truckstopConfigured } from "@/lib/agent/boards/truckstop";
import { BoardError } from "@/lib/agent/boards/types";
import { caller } from "@/lib/agent/user";
import { quickbooksConfigured, type QuickbooksConfig } from "@/lib/agent/quickbooks";
import { readGeotab, sealGeotab, type GeotabConfig } from "@/lib/agent/geotab";
import { xeroConfigured, type XeroConfig } from "@/lib/agent/xero";
import type { PayoutsConfig } from "@/lib/agent/payouts";
import { vaultConfigured } from "@/lib/portal/vault";
import { overLimit, tooMany } from "@/lib/rate-limit";

const NAMES: Record<string, string> = { samsara: "Samsara", motive: "Motive", geotab: "Geotab", load_feed: "a load feed", fuel_feed: "a fuel card statement", toll_feed: "a toll statement", truckstop: "Truckstop", dat: "DAT", payouts: "direct deposit" };
const nameOf = (kind: string) => NAMES[kind] ?? (kind.startsWith("board:") ? `the ${kind.slice(6)} board` : kind);

const Custom = z.object({
  name: z.string().trim().min(2).max(40),
  searchUrl: z.string().url().max(2000).refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", "https only"),
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
  z.object({ kind: z.literal("geotab"), database: z.string().trim().min(2).max(100), userName: z.string().trim().min(2).max(200), password: z.string().min(4).max(200) }),
  z.object({
    kind: z.enum(["fuel_feed", "toll_feed"]),
    url: z.string().url().max(2000).refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", "https only"),
    headerName: z.string().trim().max(100).optional(),
    headerValue: z.string().trim().max(2000).optional(),
    name: z.string().trim().max(60).optional(),
  }),
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
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return Response.json({ error: "sign_in" }, { status: 401 });
  const rows = await integrationsFor(who.me.carrierId);
  return Response.json({
    // Whether Backroute's own side of each board is in place (its partner agreement and login).
    available: { truckstop: truckstopConfigured(), dat: datConfigured(), quickbooks: quickbooksConfigured(), xero: xeroConfigured(), vault: vaultConfigured() },
    connections: rows.map((r) => ({
      kind: r.kind,
      status: r.status,
      checkedAt: r.checked_at,
      ...(r.kind === "load_feed" || r.kind === "fuel_feed" || r.kind === "toll_feed" ? { name: (r.config as FeedConfig).name ?? null, host: new URL((r.config as FeedConfig).url).host } : {}),
      ...(r.kind.startsWith("board:") ? { name: (r.config as CustomBoardConfig).name } : {}),
      ...(r.kind === "truckstop" || r.kind === "dat" ? { postTrucks: !!(r.config as TruckstopConfig).postTrucks } : {}),
      ...(r.kind === "gmail" || r.kind === "outlook" ? { name: (r.config as MailboxConfig).email, lastSync: (r.config as MailboxConfig).lastChecked ?? null } : {}),
      ...(r.kind === "quickbooks" ? { name: (r.config as QuickbooksConfig).companyName ?? null, lastSync: (r.config as QuickbooksConfig).lastSync ?? null } : {}),
      ...(r.kind === "xero" ? { name: (r.config as unknown as XeroConfig).tenantName ?? null, lastSync: (r.config as unknown as XeroConfig).lastSync ?? null } : {}),
      ...(r.kind === "geotab" ? { name: (r.config as unknown as GeotabConfig).database } : {}),
      ...(r.kind === "payouts" ? { name: (r.config as unknown as PayoutsConfig).company?.bankName ?? null } : {}),
    })),
  });
}

/** Connect (or replace) an ELD or a load feed. It's tried right away, and only saved if it works. */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", reason: "Check the address and the key." }, { status: 400 });
  const b = parsed.data;
  // Each connection made goes in the owner's Changes log.
  const connected = async (status: string) => {
    await auditChange(who.me.carrierId, who.me.role, "Connected", b.kind === "board" ? b.config.name : nameOf(b.kind), who.me.userId);
    return Response.json({ ok: true, status });
  };
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
        return connected(status);
      }
      // A test search from where the carrier's first truck is, so a wrong ID shows now rather than later.
      const ctx = await loadContext(who.me.carrierId);
      const truck = ctx?.trucks.find((t) => t.currentCity && t.currentState);
      const found = truck ? await board.search({ originCity: truck.currentCity, originState: truck.currentState, radius: 150, availableFrom: new Date().toISOString(), equipment: truck.equipmentType }) : [];
      const status = `Connected · test search found ${found.length} load${found.length === 1 ? "" : "s"} near ${truck?.currentCity ?? "your trucks"}`;
      await saveIntegration(who.me.carrierId, kind, config, status);
      return connected(status);
    }
    if (b.kind === "fuel_feed" || b.kind === "toll_feed") {
      // Read once now, so a wrong address or key shows here; the lines found are imported right away.
      const cfg: StatementConfig = { url: b.url, headerName: b.headerName || undefined, headerValue: b.headerValue || undefined, name: b.name || (b.kind === "fuel_feed" ? "Fuel card" : "Tolls") };
      const text = await readStatement(cfg);
      const ctx = await loadContext(who.me.carrierId);
      const r = ctx ? await importStatementText(ctx, b.kind === "fuel_feed" ? "fuel" : "toll", text) : { read: 0, matched: 0 };
      const status = `Connected · ${r.read} line${r.read === 1 ? "" : "s"} read, ${r.matched} on a load`;
      await saveIntegration(who.me.carrierId, b.kind, cfg, status);
      return connected(status);
    }
    if (b.kind === "load_feed") {
      const cfg: FeedConfig = { url: b.url, format: b.format, headerName: b.headerName || undefined, headerValue: b.headerValue || undefined, name: b.name || "Load feed" };
      const rows = await readFeed(cfg);
      const status = `Connected · ${rows.length} usable load${rows.length === 1 ? "" : "s"} in it now`;
      await saveIntegration(who.me.carrierId, "load_feed", cfg, status);
      return connected(status);
    }
    if (b.kind === "geotab") {
      // Signed in and read once now, so a wrong database or password shows here; the password is kept sealed.
      const cfg = sealGeotab(who.me.carrierId, b);
      const { vehicles, server } = await readGeotab(who.me.carrierId, cfg);
      const ctx = await loadContext(who.me.carrierId);
      const applied = ctx ? await applyEld(ctx, "geotab", { vehicles, clocks: [] }) : { trucks: 0, drivers: 0, unmatched: [] };
      const status = `Connected · ${applied.trucks} truck${applied.trucks === 1 ? "" : "s"} matched${applied.unmatched.length ? `; not matched: ${applied.unmatched.slice(0, 5).join(", ")}` : ""} · hours come from Geotab's HOS app`;
      await saveIntegration(who.me.carrierId, "geotab", { ...cfg, ...(server ? { server } : {}) } as never, status);
      return connected(status);
    }
    if (b.kind !== "samsara" && b.kind !== "motive") return Response.json({ error: "bad_request" }, { status: 400 });
    const data = await readEld(b.kind, b.apiKey);
    const ctx = await loadContext(who.me.carrierId);
    const applied = ctx ? await applyEld(ctx, b.kind, data) : { trucks: 0, drivers: 0, unmatched: [] };
    const status = `Connected · ${applied.trucks} truck${applied.trucks === 1 ? "" : "s"} and ${applied.drivers} driver${applied.drivers === 1 ? "" : "s"} matched${applied.unmatched.length ? `; not matched: ${applied.unmatched.slice(0, 5).join(", ")}` : ""}`;
    await saveIntegration(who.me.carrierId, b.kind, { apiKey: b.apiKey }, status);
    return connected(status);
  } catch (e) {
    const reason = e instanceof EldError || e instanceof FeedError || e instanceof BoardError || e instanceof StatementError ? e.message : "Couldn't connect.";
    return Response.json({ ok: false, reason }, { status: 422 });
  }
}

/**
 * "Check now": runs a saved connection once with what's on file (the ELD read, a board's test search, the feed or
 * statement read) and saves what happened, so the owner can see it works without typing the key again.
 */
export async function PATCH(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return Response.json({ error: "sign_in" }, { status: 401 });
  if (await overLimit(`int-check:${who.me.carrierId}`, 3600, 30)) return tooMany();
  const kind = new URL(request.url).searchParams.get("kind") ?? "";
  const row = (await integrationsFor(who.me.carrierId)).find((r) => r.kind === kind);
  if (!row) return Response.json({ error: "not_connected" }, { status: 404 });
  const ctx = await loadContext(who.me.carrierId);
  if (!ctx) return Response.json({ error: "not_set_up" }, { status: 503 });
  try {
    let status: string;
    if (row.kind === "samsara" || row.kind === "motive") {
      const applied = await applyEld(ctx, row.kind, await readEld(row.kind, (row.config as EldConfig).apiKey));
      status = `Connected · ${applied.trucks} truck${applied.trucks === 1 ? "" : "s"} and ${applied.drivers} driver${applied.drivers === 1 ? "" : "s"} matched${applied.unmatched.length ? `; not matched: ${applied.unmatched.slice(0, 5).join(", ")}` : ""}`;
    } else if (row.kind === "geotab") {
      const { vehicles } = await readGeotab(who.me.carrierId, row.config as unknown as GeotabConfig);
      const applied = await applyEld(ctx, "geotab", { vehicles, clocks: [] });
      status = `Connected · ${applied.trucks} truck${applied.trucks === 1 ? "" : "s"} matched${applied.unmatched.length ? `; not matched: ${applied.unmatched.slice(0, 5).join(", ")}` : ""}`;
    } else if (row.kind === "load_feed") {
      const rows = await readFeed(row.config as FeedConfig);
      status = `Connected · ${rows.length} usable load${rows.length === 1 ? "" : "s"} in it now`;
    } else if (row.kind === "fuel_feed" || row.kind === "toll_feed") {
      const r = await importStatementText(ctx, row.kind === "fuel_feed" ? "fuel" : "toll", await readStatement(row.config as StatementConfig));
      status = `Connected · ${r.read} new line${r.read === 1 ? "" : "s"}, ${r.matched} on a load`;
    } else if (row.kind === "truckstop" || row.kind === "dat" || row.kind.startsWith("board:")) {
      const board = boardFor(row);
      if (!board) return Response.json({ ok: true, status: row.status ?? "Saved · waiting on Backroute's agreement with this board" });
      const truck = ctx.trucks.find((t) => t.currentCity && t.currentState);
      const found = truck ? await board.search({ originCity: truck.currentCity, originState: truck.currentState, radius: 150, availableFrom: new Date().toISOString(), equipment: truck.equipmentType }) : [];
      status = `Connected · test search found ${found.length} load${found.length === 1 ? "" : "s"} near ${truck?.currentCity ?? "your trucks"}`;
    } else {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    await setStatus(who.me.carrierId, row.kind, status);
    return Response.json({ ok: true, status });
  } catch (e) {
    const reason = e instanceof EldError || e instanceof FeedError || e instanceof BoardError || e instanceof StatementError ? e.message : "Couldn't reach it.";
    await setStatus(who.me.carrierId, row.kind, `Not working: ${reason}`);
    return Response.json({ ok: false, reason }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const who = await caller(request);
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return Response.json({ error: "sign_in" }, { status: 401 });
  const kind = z.union([z.enum(["samsara", "motive", "geotab", "load_feed", "fuel_feed", "toll_feed", "truckstop", "dat", "payouts"]), z.string().regex(/^board:[a-z0-9_-]{1,40}$/)]).safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return Response.json({ error: "bad_request" }, { status: 400 });
  await removeIntegration(who.me.carrierId, kind.data as IntegrationKind);
  await auditChange(who.me.carrierId, who.me.role, "Disconnected", nameOf(kind.data), who.me.userId);
  return Response.json({ ok: true });
}
