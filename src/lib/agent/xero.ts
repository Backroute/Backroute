import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { Load } from "../types";
import { open, seal, vaultConfigured } from "../portal/vault";
import { admin, claimMark, releaseMark, type CarrierContext } from "./db";
import { saveIntegration, setStatus, type IntegrationRow } from "./integrations";
import { termsDays } from "./money";

/**
 * Xero, for carriers whose books are there instead of QuickBooks: the owner connects their organisation once (Xero's
 * sign-in), and every hour each invoice sent to a broker goes in as a sales invoice (the broker as the contact, one line
 * per charge) and, when the broker pays, the payment against it. Each goes in once.
 *
 * Backroute's Xero app: XERO_CLIENT_ID and XERO_CLIENT_SECRET, with PUBLIC_BASE_URL/api/integrations/xero/callback as
 * its redirect address. The account codes default to Xero's standard chart (200 Sales, 090 Business Bank Account) and
 * the owner can change them when connecting, since many organisations use their own.
 */

export const xeroConfigured = () => Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.PUBLIC_BASE_URL && vaultConfigured());
const AUTH = () => process.env.XERO_AUTH_URL ?? "https://login.xero.com/identity/connect/authorize";
const TOKEN = () => process.env.XERO_TOKEN_URL ?? "https://identity.xero.com/connect/token";
const REVOKE = () => process.env.XERO_REVOKE_URL ?? "https://identity.xero.com/connect/revocation";
const CONNECTIONS = () => process.env.XERO_CONNECTIONS_URL ?? "https://api.xero.com/connections";
const API = () => (process.env.XERO_API_BASE ?? "https://api.xero.com/api.xro/2.0").replace(/\/$/, "");
const REDIRECT = () => `${process.env.PUBLIC_BASE_URL!.replace(/\/$/, "")}/api/integrations/xero/callback`;
const DAY = 86400_000;

export interface XeroConfig {
  tenantId: string;
  tenantName?: string;
  /** Xero's refresh token, sealed. It changes every time it's used. */
  refresh: string;
  connectedAt: string;
  /** Where invoice lines and payments go in the organisation's chart of accounts. */
  salesAccount: string;
  bankAccount: string;
  lastSync?: string;
}

export class XeroError extends Error {}

const stateKey = () => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("backroute-xero-connect").digest();
const signState = (body: string) => createHmac("sha256", stateKey()).update(body).digest("base64url");

/** Xero's sign-in page, with a signed note of who asked and the account codes they chose (15 minutes). */
export function xeroConnectUrl(carrierId: string, userId: string, codes: { sales: string; bank: string }, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ c: carrierId, u: userId, s: codes.sales, b: codes.bank, x: Math.floor(now / 1000) + 15 * 60 })).toString("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID!,
    redirect_uri: REDIRECT(),
    scope: "openid offline_access accounting.transactions accounting.contacts",
    state: `${body}.${signState(body)}`,
  });
  return `${AUTH()}?${q}`;
}

export function readXeroState(state: string, now = Date.now()): { carrierId: string; userId: string; sales: string; bank: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(signState(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { c?: string; u?: string; s?: string; b?: string; x?: number };
    return p.c && p.u && p.x && p.x * 1000 >= now ? { carrierId: p.c, userId: p.u, sales: p.s || "200", bank: p.b || "090" } : null;
  } catch {
    return null;
  }
}

const basic = () => `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64")}`;

async function tokens(form: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN(), { method: "POST", headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token || !body.refresh_token) throw new XeroError(body.error === "invalid_grant" ? "Xero sign-in expired. Connect it again." : `Xero sign-in failed (${res.status}).`);
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in ?? 1800 };
}

const bind = (carrierId: string, tenantId: string) => `${carrierId}|xero|${tenantId}`;
const access = new Map<string, { token: string; until: number }>();

/** Xero sent the owner back with a code: trade it, find their organisation, keep the sign-in sealed. */
export async function finishXero(carrierId: string, code: string, codes: { sales: string; bank: string }): Promise<XeroConfig> {
  const t = await tokens({ grant_type: "authorization_code", code, redirect_uri: REDIRECT() });
  const res = await fetch(CONNECTIONS(), { headers: { authorization: `Bearer ${t.access_token}`, accept: "application/json" }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  const orgs = (await res.json().catch(() => [])) as { tenantId?: string; tenantName?: string; tenantType?: string }[];
  const org = orgs.find((o) => o.tenantId && (!o.tenantType || o.tenantType === "ORGANISATION"));
  if (!res.ok || !org?.tenantId) throw new XeroError("Xero didn't share an organisation. Connect again and pick one.");
  access.set(carrierId, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  const config: XeroConfig = { tenantId: org.tenantId, tenantName: org.tenantName, refresh: seal(t.refresh_token, bind(carrierId, org.tenantId)), connectedAt: new Date().toISOString(), salesAccount: codes.sales, bankAccount: codes.bank };
  await saveIntegration(carrierId, "xero", config as never, `Connected${org.tenantName ? ` to ${org.tenantName}` : ""} · first sync within the hour`);
  return config;
}

export async function disconnectXero(carrierId: string, config: XeroConfig) {
  const refresh = open(config.refresh, bind(carrierId, config.tenantId))?.value;
  if (refresh) await fetch(REVOKE(), { method: "POST", headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh }), signal: AbortSignal.timeout(10000) }).catch(() => 0);
  access.delete(carrierId);
}

async function accessToken(carrierId: string, config: XeroConfig): Promise<string> {
  const hit = access.get(carrierId);
  if (hit && hit.until > Date.now()) return hit.token;
  const refresh = open(config.refresh, bind(carrierId, config.tenantId));
  if (!refresh) throw new XeroError("Xero sign-in can't be read. Connect it again.");
  const t = await tokens({ grant_type: "refresh_token", refresh_token: refresh.value });
  access.set(carrierId, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  // Xero's refresh tokens are single-use: the new one is kept at once.
  config.refresh = seal(t.refresh_token, bind(carrierId, config.tenantId));
  await admin().from("carrier_integrations").update({ config }).eq("carrier_id", carrierId).eq("kind", "xero");
  return t.access_token;
}

async function api(carrierId: string, config: XeroConfig, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken(carrierId, config)}`, "xero-tenant-id": config.tenantId, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown> & { Message?: string; Elements?: { ValidationErrors?: { Message?: string }[] }[] };
  if (res.status === 401) access.delete(carrierId);
  if (!res.ok) throw new XeroError(`Xero: ${out.Elements?.[0]?.ValidationErrors?.[0]?.Message ?? out.Message ?? res.status}`);
  return out;
}

const money = (n: number) => Math.round(n * 100) / 100;
const lane = (l: Load) => `${l.lane.origin}, ${l.lane.originState} to ${l.lane.destination}, ${l.lane.destState}`;

/** The invoice Xero gets for a load: one line per charge, the broker as the contact, due on the rate con's terms. */
export function xeroInvoice(l: Load, broker: string, salesAccount: string) {
  const inv = l.invoice!;
  const date = (inv.sentAt ?? inv.draftedAt).slice(0, 10);
  const due = new Date(Date.parse(`${date}T12:00:00Z`) + termsDays(l.rateConReading?.paymentTerms) * DAY).toISOString().slice(0, 10);
  const lines = inv.lines?.length ? inv.lines : [{ label: "Line haul, all in", amount: inv.amount }];
  return {
    Type: "ACCREC",
    Contact: { Name: broker },
    Date: date,
    DueDate: due,
    InvoiceNumber: inv.number,
    Reference: l.referenceNumber,
    LineAmountTypes: "NoTax",
    Status: "AUTHORISED",
    LineItems: lines.map((x) => ({ Description: `${x.label} · ${l.referenceNumber} · ${lane(l)}`, Quantity: 1, UnitAmount: money(x.amount), AccountCode: salesAccount })),
  };
}

async function once(ctx: CarrierContext, key: string, kind: string, push: () => Promise<Record<string, unknown>>): Promise<boolean> {
  if (!(await claimMark(ctx.carrier.id, key, kind))) return false;
  try {
    const data = await push();
    await admin().from("agent_marks").update({ data }).eq("carrier_id", ctx.carrier.id).eq("load_id", key).eq("kind", kind);
    return true;
  } catch (e) {
    await releaseMark(ctx.carrier.id, key, kind);
    throw e;
  }
}

/** Puts in what's new: invoices sent in the last 60 days, and payments brokers made on them. */
export async function syncXero(ctx: CarrierContext, config: XeroConfig, now = Date.now()): Promise<{ invoices: number; payments: number }> {
  const since = now - 60 * DAY;
  const K = { invoice: `xero_invoice:${config.tenantId}`, payment: `xero_payment:${config.tenantId}` };
  const marks = await admin().from("agent_marks").select("load_id, kind, data").eq("carrier_id", ctx.carrier.id).in("kind", [K.invoice, K.payment]);
  const invoiceIds = new Map((marks.data ?? []).filter((m) => m.kind === K.invoice).map((m) => [m.load_id as string, (m.data as { id?: string } | null)?.id]));
  const paid = new Set((marks.data ?? []).filter((m) => m.kind === K.payment).map((m) => m.load_id as string));
  const n = { invoices: 0, payments: 0 };
  let budget = 50;
  for (const l of ctx.loads) {
    if (budget <= 0) break;
    const inv = l.invoice;
    if (!inv?.sentAt || Date.parse(inv.sentAt) < since || l.stage === "cancelled") continue;
    if (!invoiceIds.has(l.id)) {
      const broker = ctx.brokers.find((b) => b.id === l.brokerId)?.company ?? "Broker";
      const made = await once(ctx, l.id, K.invoice, async () => {
        const out = (await api(ctx.carrier.id, config, "POST", "/Invoices", { Invoices: [xeroInvoice(l, broker, config.salesAccount)] })) as { Invoices?: { InvoiceID?: string }[] };
        const id = out.Invoices?.[0]?.InvoiceID;
        if (!id) throw new XeroError("Xero didn't return the invoice.");
        invoiceIds.set(l.id, id);
        return { id, amount: inv.amount };
      });
      if (made) n.invoices++;
      budget--;
    }
    const id = invoiceIds.get(l.id);
    if (inv.paidAt && id && !paid.has(l.id)) {
      const amount = money(inv.paidAmount ?? inv.amount);
      const made = await once(ctx, l.id, K.payment, async () => {
        await api(ctx.carrier.id, config, "PUT", "/Payments", { Payments: [{ Invoice: { InvoiceID: id }, Account: { Code: config.bankAccount }, Date: inv.paidAt!.slice(0, 10), Amount: amount }] });
        return { amount };
      });
      if (made) n.payments++;
      budget--;
    }
  }
  config.lastSync = new Date(now).toISOString();
  await admin().from("carrier_integrations").update({ config }).eq("carrier_id", ctx.carrier.id).eq("kind", "xero");
  return n;
}

/** The hourly run, from the dispatch rounds. */
export async function xeroRound(ctx: CarrierContext, links: IntegrationRow[], now: number): Promise<string[]> {
  if (!xeroConfigured()) return [];
  const row = links.find((r) => r.kind === "xero");
  if (!row) return [];
  const config = row.config as unknown as XeroConfig;
  if (config.lastSync && now - Date.parse(config.lastSync) < 55 * 60_000) return [];
  try {
    const n = await syncXero(ctx, config, now);
    const what = [n.invoices && `${n.invoices} invoice${n.invoices === 1 ? "" : "s"}`, n.payments && `${n.payments} payment${n.payments === 1 ? "" : "s"}`].filter(Boolean).join(", ");
    await setStatus(ctx.carrier.id, "xero", `Connected${config.tenantName ? ` to ${config.tenantName}` : ""} · ${what ? `last put in ${what}` : "up to date"}`);
    return what ? [`Xero: ${what}`] : [];
  } catch (e) {
    await setStatus(ctx.carrier.id, "xero", `Not working: ${e instanceof Error ? e.message : "error"}`);
    return [];
  }
}
