import { dbConfigured, loadContext } from "@/lib/agent/db";
import { integrationsFor, removeIntegration, setStatus } from "@/lib/agent/integrations";
import { connectUrl, disconnect, quickbooksConfigured, syncQuickbooks, type QuickbooksConfig } from "@/lib/agent/quickbooks";
import { caller } from "@/lib/agent/user";
import { overLimit, tooMany } from "@/lib/rate-limit";

/**
 * QuickBooks Online for the owner: POST starts connecting (the app sends them to Intuit's page), PUT puts what's new in
 * right now instead of waiting for the hourly run, DELETE disconnects. Owner only: it's their books.
 */

async function owner(request: Request) {
  if (!dbConfigured()) return { error: Response.json({ error: "not_set_up" }, { status: 503 }) };
  const who = await caller(request);
  if (!who || who.me.role !== "owner") return { error: Response.json({ error: "sign_in" }, { status: 401 }) };
  if (!quickbooksConfigured()) return { error: Response.json({ error: "quickbooks_off" }, { status: 503 }) };
  return { who };
}

export async function POST(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  return Response.json({ url: connectUrl(o.who.me.carrierId, o.who.me.userId) });
}

export async function PUT(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  if (await overLimit(`qbo-sync:${o.who.me.carrierId}`, 6, 3600)) return tooMany();
  const row = (await integrationsFor(o.who.me.carrierId)).find((r) => r.kind === "quickbooks");
  const ctx = await loadContext(o.who.me.carrierId);
  if (!row || !ctx) return Response.json({ error: "not_connected" }, { status: 404 });
  try {
    const n = await syncQuickbooks(ctx, row.config as unknown as QuickbooksConfig);
    await setStatus(ctx.carrier.id, "quickbooks", `Connected${(row.config as unknown as QuickbooksConfig).companyName ? ` to ${(row.config as unknown as QuickbooksConfig).companyName}` : ""} · up to date`);
    return Response.json({ ok: true, ...n });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    await setStatus(ctx.carrier.id, "quickbooks", `Not working: ${reason}`);
    return Response.json({ error: "sync_failed", reason }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role !== "owner") return Response.json({ error: "sign_in" }, { status: 401 });
  const row = (await integrationsFor(who.me.carrierId)).find((r) => r.kind === "quickbooks");
  if (row) await disconnect(who.me.carrierId, row.config as unknown as QuickbooksConfig).catch(() => 0);
  await removeIntegration(who.me.carrierId, "quickbooks");
  return Response.json({ ok: true });
}
