import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { integrationsFor, removeIntegration, setStatus } from "@/lib/agent/integrations";
import { disconnectXero, syncXero, xeroConfigured, xeroConnectUrl, type XeroConfig } from "@/lib/agent/xero";
import { caller } from "@/lib/agent/user";
import { overLimit, tooMany } from "@/lib/rate-limit";

/** Xero for the owner: POST starts connecting (with the account codes to use), PUT syncs now, DELETE disconnects. */
async function owner(request: Request) {
  if (!dbConfigured()) return { error: Response.json({ error: "not_set_up" }, { status: 503 }) };
  const who = await caller(request);
  if (!who || who.me.role !== "owner") return { error: Response.json({ error: "sign_in" }, { status: 401 }) };
  if (!xeroConfigured()) return { error: Response.json({ error: "xero_off" }, { status: 503 }) };
  return { who };
}

const Codes = z.object({ sales: z.string().trim().regex(/^[A-Za-z0-9.-]{1,10}$/).default("200"), bank: z.string().trim().regex(/^[A-Za-z0-9.-]{1,10}$/).default("090") });

export async function POST(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  const codes = Codes.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!codes.success) return Response.json({ error: "bad_request", reason: "Account codes are short codes like 200." }, { status: 400 });
  return Response.json({ url: xeroConnectUrl(o.who.me.carrierId, o.who.me.userId, codes.data) });
}

export async function PUT(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  if (await overLimit(`xero-sync:${o.who.me.carrierId}`, 3600, 12)) return tooMany();
  const row = (await integrationsFor(o.who.me.carrierId)).find((r) => r.kind === "xero");
  const ctx = await loadContext(o.who.me.carrierId);
  if (!row || !ctx) return Response.json({ error: "not_connected" }, { status: 404 });
  const config = row.config as unknown as XeroConfig;
  try {
    const n = await syncXero(ctx, config);
    await setStatus(ctx.carrier.id, "xero", `Connected${config.tenantName ? ` to ${config.tenantName}` : ""} · up to date`);
    return Response.json({ ok: true, ...n });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    await setStatus(ctx.carrier.id, "xero", `Not working: ${reason}`);
    return Response.json({ error: "sync_failed", reason }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role !== "owner") return Response.json({ error: "sign_in" }, { status: 401 });
  const row = (await integrationsFor(who.me.carrierId)).find((r) => r.kind === "xero");
  if (row) await disconnectXero(who.me.carrierId, row.config as unknown as XeroConfig).catch(() => 0);
  await removeIntegration(who.me.carrierId, "xero");
  return Response.json({ ok: true });
}
