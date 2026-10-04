import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { Expense, FuelTx, Load, TollTx } from "../types";
import { open, seal, vaultConfigured } from "../portal/vault";
import { admin, claimMark, releaseMark, type CarrierContext } from "./db";
import { saveIntegration, setStatus, type IntegrationRow } from "./integrations";
import { termsDays } from "./money";
import { passToOwner } from "./dispatcher";

/**
 * QuickBooks Online, kept in step on its own: the owner connects their company once (Intuit's sign-in), and every
 * hour the AI puts in what the bookkeeper would otherwise type: each invoice sent to a broker (the broker as the
 * customer, one line per charge), the payment when the broker pays, and the costs (fuel, tolls, the lumpers and scales
 * drivers paid). Each goes in once; the CSV downloads stay for anyone not on QuickBooks.
 *
 * Backroute's Intuit app: QBO_CLIENT_ID and QBO_CLIENT_SECRET, with PUBLIC_BASE_URL/api/integrations/quickbooks/callback
 * as its redirect address; QBO_ENV=sandbox for Intuit's test companies. The company's sign-in is kept encrypted
 * (PORTAL_VAULT_KEY), like every other secret a carrier gives Backroute.
 */

export const quickbooksConfigured = () => Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.PUBLIC_BASE_URL && vaultConfigured());
const AUTH = () => process.env.QBO_AUTH_URL ?? "https://appcenter.intuit.com/connect/oauth2";
const TOKEN = () => process.env.QBO_TOKEN_URL ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE = () => process.env.QBO_REVOKE_URL ?? "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const API = () => (process.env.QBO_API_BASE ?? (process.env.QBO_ENV === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com")).replace(/\/$/, "");
const REDIRECT = () => `${process.env.PUBLIC_BASE_URL!.replace(/\/$/, "")}/api/integrations/quickbooks/callback`;
const MINOR = "minorversion=75";
const DAY = 86400_000;

export interface QuickbooksConfig {
  realmId: string;
  /** The company's sign-in for Backroute (Intuit's refresh token), sealed. It changes as it's used. */
  refresh: string;
  companyName?: string;
  connectedAt: string;
  /** What Backroute set up in the books, found or made the first time. */
  ids?: Partial<Record<"item" | "income" | "pay" | "payType" | "fuel" | "tolls" | "driver", string>>;
  lastSync?: string;
}

export class QuickbooksError extends Error {}

// ─── Connecting ──────────────────────────────────────────────────────────────

const stateKey = () => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("backroute-quickbooks-connect").digest();
const signState = (body: string) => createHmac("sha256", stateKey()).update(body).digest("base64url");

/** Where the owner goes to let Backroute into their QuickBooks: Intuit's page, with a signed note of who asked. */
export function connectUrl(carrierId: string, userId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ c: carrierId, u: userId, x: Math.floor(now / 1000) + 15 * 60 })).toString("base64url");
  const q = new URLSearchParams({ client_id: process.env.QBO_CLIENT_ID!, response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: REDIRECT(), state: `${body}.${signState(body)}` });
  return `${AUTH()}?${q}`;
}

export function readState(state: string, now = Date.now()): { carrierId: string; userId: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(signState(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { c?: string; u?: string; x?: number };
    return p.c && p.u && p.x && p.x * 1000 >= now ? { carrierId: p.c, userId: p.u } : null;
  } catch {
    return null;
  }
}

const basic = () => `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`;

async function tokens(form: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN(), { method: "POST", headers: { authorization: basic(), accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token || !body.refresh_token) throw new QuickbooksError(body.error === "invalid_grant" ? "QuickBooks sign-in expired. Connect it again." : `QuickBooks sign-in failed (${res.status}).`);
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in ?? 3600 };
}

const bind = (carrierId: string, realmId: string) => `${carrierId}|quickbooks|${realmId}`;
const access = new Map<string, { token: string; until: number }>();

/** Intuit sent the owner back with a code: trade it for the company's sign-in and keep it, sealed. */
export async function finishConnect(carrierId: string, code: string, realmId: string): Promise<QuickbooksConfig> {
  const t = await tokens({ grant_type: "authorization_code", code, redirect_uri: REDIRECT() });
  access.set(carrierId, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  const config: QuickbooksConfig = { realmId, refresh: seal(t.refresh_token, bind(carrierId, realmId)), connectedAt: new Date().toISOString() };
  const info = (await api(carrierId, config, "GET", `/companyinfo/${encodeURIComponent(realmId)}`).catch(() => null)) as { CompanyInfo?: { CompanyName?: string } } | null;
  config.companyName = info?.CompanyInfo?.CompanyName;
  await saveIntegration(carrierId, "quickbooks", config, `Connected${config.companyName ? ` to ${config.companyName}` : ""} · first sync within the hour`);
  return config;
}

export async function disconnect(carrierId: string, config: QuickbooksConfig) {
  const refresh = open(config.refresh, bind(carrierId, config.realmId))?.value;
  if (refresh) await fetch(REVOKE(), { method: "POST", headers: { authorization: basic(), accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ token: refresh }), signal: AbortSignal.timeout(10000) }).catch(() => 0);
  access.delete(carrierId);
}

async function accessToken(carrierId: string, config: QuickbooksConfig): Promise<string> {
  const hit = access.get(carrierId);
  if (hit && hit.until > Date.now()) return hit.token;
  const refresh = open(config.refresh, bind(carrierId, config.realmId));
  if (!refresh) throw new QuickbooksError("QuickBooks sign-in can't be read. Connect it again.");
  const t = await tokens({ grant_type: "refresh_token", refresh_token: refresh.value });
  access.set(carrierId, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  // Intuit hands out a new sign-in as the old one is used: keep the new one (and re-seal with today's key).
  if (t.refresh_token !== refresh.value || refresh.stale) {
    config.refresh = seal(t.refresh_token, bind(carrierId, config.realmId));
    await admin().from("carrier_integrations").update({ config }).eq("carrier_id", carrierId).eq("kind", "quickbooks");
  }
  return t.access_token;
}

async function api(carrierId: string, config: QuickbooksConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const url = `${API()}/v3/company/${encodeURIComponent(config.realmId)}${path}${path.includes("?") ? "&" : "?"}${MINOR}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken(carrierId, config)}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const out = (await res.json().catch(() => ({}))) as { Fault?: { Error?: { Message?: string; Detail?: string }[] } };
  if (res.status === 401) access.delete(carrierId);
  if (!res.ok || out.Fault) throw new QuickbooksError(`QuickBooks: ${out.Fault?.Error?.[0]?.Detail ?? out.Fault?.Error?.[0]?.Message ?? res.status}`);
  return out;
}

const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function query<T>(carrierId: string, config: QuickbooksConfig, q: string): Promise<T[]> {
  const out = (await api(carrierId, config, "GET", `/query?query=${encodeURIComponent(q)}`)) as { QueryResponse?: Record<string, T[]> };
  const r = out.QueryResponse ?? {};
  const key = Object.keys(r).find((k) => Array.isArray(r[k]));
  return key ? r[key] : [];
}

// ─── Setting up the books ────────────────────────────────────────────────────

async function account(ctx: CarrierContext, config: QuickbooksConfig, name: string, type: "Income" | "Expense", subType: string): Promise<string> {
  const found = await query<{ Id: string }>(ctx.carrier.id, config, `select Id from Account where Name = '${quote(name)}'`);
  if (found[0]) return found[0].Id;
  const made = (await api(ctx.carrier.id, config, "POST", "/account", { Name: name, AccountType: type, AccountSubType: subType })) as { Account: { Id: string } };
  return made.Account.Id;
}

/** The freight item, the expense accounts, and the account costs are paid from: found by name, made when missing. */
async function setUp(ctx: CarrierContext, config: QuickbooksConfig): Promise<Required<NonNullable<QuickbooksConfig["ids"]>>> {
  const ids = { ...(config.ids ?? {}) };
  if (!ids.income) ids.income = await account(ctx, config, "Freight Income", "Income", "ServiceFeeIncome");
  if (!ids.item) {
    const found = await query<{ Id: string }>(ctx.carrier.id, config, "select Id from Item where Name = 'Freight'");
    ids.item = found[0]?.Id ?? ((await api(ctx.carrier.id, config, "POST", "/item", { Name: "Freight", Type: "Service", IncomeAccountRef: { value: ids.income } })) as { Item: { Id: string } }).Item.Id;
  }
  if (!ids.fuel) ids.fuel = await account(ctx, config, "Fuel", "Expense", "Auto");
  if (!ids.tolls) ids.tolls = await account(ctx, config, "Tolls and Scales", "Expense", "Auto");
  if (!ids.driver) ids.driver = await account(ctx, config, "Lumper and Driver Expenses", "Expense", "OtherMiscellaneousServiceCost");
  if (!ids.pay) {
    // Costs come off the company's fuel card when it has a credit card account in the books, else its bank account.
    const card = await query<{ Id: string }>(ctx.carrier.id, config, "select Id from Account where AccountType = 'Credit Card' maxresults 1");
    const bank = card[0] ? [] : await query<{ Id: string }>(ctx.carrier.id, config, "select Id from Account where AccountType = 'Bank' maxresults 1");
    const id = card[0]?.Id ?? bank[0]?.Id;
    if (!id) throw new QuickbooksError("QuickBooks has no bank or credit card account to record costs against. Add one in QuickBooks.");
    ids.pay = id;
    ids.payType = card[0] ? "CreditCard" : "Cash";
  }
  config.ids = ids;
  return ids as Required<NonNullable<QuickbooksConfig["ids"]>>;
}

async function customerFor(ctx: CarrierContext, config: QuickbooksConfig, load: Load, made: Map<string, string>): Promise<string> {
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const name = (broker?.company || "Broker").slice(0, 100);
  if (made.has(name)) return made.get(name)!;
  const found = await query<{ Id: string }>(ctx.carrier.id, config, `select Id from Customer where DisplayName = '${quote(name)}'`);
  const id =
    found[0]?.Id ??
    ((await api(ctx.carrier.id, config, "POST", "/customer", { DisplayName: name, CompanyName: name, ...(broker?.email ? { PrimaryEmailAddr: { Address: broker.email } } : {}), ...(broker?.mc ? { Notes: `MC ${broker.mc}` } : {}) })) as { Customer: { Id: string } }).Customer.Id;
  made.set(name, id);
  return id;
}

// ─── Keeping it in step ──────────────────────────────────────────────────────

const lane = (l: Load) => `${l.lane.origin}, ${l.lane.originState} to ${l.lane.destination}, ${l.lane.destState}`;
const money = (n: number) => Math.round(n * 100) / 100;

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

async function recordsOf<T>(carrierId: string, kind: "fuel" | "toll" | "expense", since: string): Promise<T[]> {
  const { data, error } = await admin().from("records").select("data").eq("carrier_id", carrierId).eq("kind", kind).gte("updated_at", since).limit(500);
  if (error) throw error;
  return (data ?? []).map((r) => r.data as T);
}

/**
 * Puts what's new into QuickBooks: invoices sent, payments in, and costs, from the last 60 days (and never from before
 * the company was connected less 60 days). At most 60 entries a run; the rest go next hour.
 */
export async function syncQuickbooks(ctx: CarrierContext, config: QuickbooksConfig, now = Date.now()): Promise<{ invoices: number; payments: number; costs: number; updated: number }> {
  const ids = await setUp(ctx, config);
  const since = Math.max(now - 60 * DAY, Date.parse(config.connectedAt) - 60 * DAY);
  const after = (iso?: string) => !!iso && Date.parse(iso) >= since;
  const customers = new Map<string, string>();
  let budget = 60;
  const n = { invoices: 0, payments: 0, costs: 0, updated: 0 };
  const marks = await admin().from("agent_marks").select("load_id, kind, data").eq("carrier_id", ctx.carrier.id).in("kind", ["qbo_invoice", "qbo_payment"]);
  type InvoiceMark = { id?: string; amount?: number; voided?: boolean };
  const invoiceMarks = new Map((marks.data ?? []).filter((m) => m.kind === "qbo_invoice").map((m) => [m.load_id as string, (m.data ?? {}) as InvoiceMark]));
  const invoiceIds = new Map([...invoiceMarks].map(([k, v]) => [k, v.id]));
  const paidInBooks = new Set((marks.data ?? []).filter((m) => m.kind === "qbo_payment").map((m) => m.load_id as string));
  const setMark = (loadId: string, data: InvoiceMark) => admin().from("agent_marks").update({ data }).eq("carrier_id", ctx.carrier.id).eq("load_id", loadId).eq("kind", "qbo_invoice");
  const invoiceLines = (l: Load) => (l.invoice!.lines?.length ? l.invoice!.lines : [{ label: "Line haul, all in", amount: l.invoice!.amount }]).map((x) => ({ DetailType: "SalesItemLineDetail", Amount: money(x.amount), Description: `${x.label} · ${l.referenceNumber} · ${lane(l)}`, SalesItemLineDetail: { ItemRef: { value: ids.item }, Qty: 1, UnitPrice: money(x.amount) } }));
  const syncToken = async (id: string) => ((await api(ctx.carrier.id, config, "GET", `/invoice/${encodeURIComponent(id)}`)) as { Invoice?: { SyncToken?: string } }).Invoice?.SyncToken ?? "0";

  for (const l of ctx.loads) {
    const inv = l.invoice;
    if (budget <= 0) break;
    if (!inv?.sentAt || !after(inv.sentAt)) continue;
    const mark = invoiceMarks.get(l.id);
    if (mark?.id && !mark.voided && !paidInBooks.has(l.id)) {
      // The broker cancelled after the invoice went out (and it isn't a TONU bill): voided in the books too.
      if (l.stage === "cancelled" && !(inv.lines ?? []).some((x) => /tonu/i.test(x.label))) {
        await api(ctx.carrier.id, config, "POST", "/invoice?operation=void", { Id: mark.id, SyncToken: await syncToken(mark.id) });
        await setMark(l.id, { ...mark, voided: true });
        n.updated++;
        budget--;
        continue;
      }
      // Charges changed after it went in (detention, a lumper added): the invoice in the books is brought up to date.
      if (typeof mark.amount === "number" && money(mark.amount) !== money(inv.amount)) {
        await api(ctx.carrier.id, config, "POST", "/invoice", { Id: mark.id, SyncToken: await syncToken(mark.id), sparse: true, Line: invoiceLines(l) });
        await setMark(l.id, { ...mark, amount: inv.amount });
        n.updated++;
        budget--;
      }
    }
    if (!invoiceIds.has(l.id) && l.stage !== "cancelled") {
      const customer = await customerFor(ctx, config, l, customers);
      const date = inv.sentAt.slice(0, 10);
      const days = termsDays(l.rateConReading?.paymentTerms);
      await once(ctx, l.id, "qbo_invoice", async () => {
        // Already in the books under that number (typed in by hand, or sent before): linked, not made twice.
        const there = await query<{ Id: string }>(ctx.carrier.id, config, `select Id from Invoice where DocNumber = '${quote(inv.number.slice(0, 21))}'`);
        if (there[0]) {
          invoiceIds.set(l.id, there[0].Id);
          return { id: there[0].Id, customer, amount: inv.amount, found: true };
        }
        const made = (await api(ctx.carrier.id, config, "POST", "/invoice", {
          DocNumber: inv.number.slice(0, 21),
          TxnDate: date,
          DueDate: new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10),
          CustomerRef: { value: customer },
          PrivateNote: `Load ${l.referenceNumber} · ${lane(l)} · from Backroute`,
          ...(l.brokerContactEmail ? { BillEmail: { Address: l.brokerContactEmail } } : {}),
          Line: invoiceLines(l),
        })) as { Invoice: { Id: string } };
        invoiceIds.set(l.id, made.Invoice.Id);
        return { id: made.Invoice.Id, customer, amount: inv.amount };
      });
      n.invoices++;
      budget--;
    }
    const qboId = invoiceIds.get(l.id);
    if (inv.paidAt && qboId && budget > 0) {
      const customer = await customerFor(ctx, config, l, customers);
      const paid = money(inv.paidAmount ?? inv.amount);
      if (
        await once(ctx, l.id, "qbo_payment", async () => {
          const made = (await api(ctx.carrier.id, config, "POST", "/payment", { CustomerRef: { value: customer }, TotalAmt: paid, TxnDate: inv.paidAt!.slice(0, 10), PrivateNote: `Load ${l.referenceNumber} · from Backroute`, Line: [{ Amount: paid, LinkedTxn: [{ TxnId: qboId, TxnType: "Invoice" }] }] })) as { Payment: { Id: string } };
          return { id: made.Payment.Id, amount: paid };
        })
      ) {
        n.payments++;
        budget--;
      }
    }
  }

  const sinceIso = new Date(since).toISOString();
  const cost = async (key: string, date: string, amount: number, accountId: string, what: string) => {
    if (budget <= 0 || amount <= 0) return;
    const pushed = await once(ctx, key, "qbo_cost", async () => {
      // Already typed in by hand (same day, same amount): left alone, so it isn't in the books twice.
      const there = await query<{ Id: string }>(ctx.carrier.id, config, `select Id from Purchase where TxnDate = '${date}' and TotalAmt = '${money(amount)}'`);
      if (there[0]) return { id: there[0].Id, amount: money(amount), found: true };
      const made = (await api(ctx.carrier.id, config, "POST", "/purchase", {
        PaymentType: ids.payType,
        AccountRef: { value: ids.pay },
        TxnDate: date,
        PrivateNote: `${what} · from Backroute`,
        Line: [{ DetailType: "AccountBasedExpenseLineDetail", Amount: money(amount), Description: what, AccountBasedExpenseLineDetail: { AccountRef: { value: accountId } } }],
      })) as { Purchase: { Id: string } };
      return { id: made.Purchase.Id, amount: money(amount) };
    });
    if (pushed) {
      n.costs++;
      budget--;
    }
  };
  const unit = (truckId: string | null, fallback: string) => ctx.trucks.find((t) => t.id === truckId)?.unitNumber ?? fallback;
  for (const f of await recordsOf<FuelTx>(ctx.carrier.id, "fuel", sinceIso)) {
    if (!after(`${f.date}T12:00:00Z`)) continue;
    await cost(`fuel:${f.id}`, f.date, f.amount, ids.fuel, `${f.product === "def" ? "DEF" : f.product === "reefer" ? "Reefer fuel" : "Diesel"}, ${f.gallons} gal · ${f.merchant}, ${f.city} ${f.state} · truck ${unit(f.truckId, f.unit)}`);
  }
  for (const t of await recordsOf<TollTx>(ctx.carrier.id, "toll", sinceIso)) {
    if (!after(`${t.date}T12:00:00Z`)) continue;
    await cost(`toll:${t.id}`, t.date, t.amount, ids.tolls, `Toll · ${t.agency} ${t.plaza}, ${t.state} · truck ${unit(t.truckId, t.unit)}`);
  }
  for (const e of await recordsOf<Expense>(ctx.carrier.id, "expense", sinceIso)) {
    if (e.status !== "approved" || !after(e.respondedAt ?? e.createdAt)) continue;
    const driver = ctx.drivers.find((d) => d.id === e.driverId)?.name ?? "Driver";
    const load = ctx.loads.find((l) => l.id === e.loadId);
    await cost(`expense:${e.id}`, (e.respondedAt ?? e.createdAt).slice(0, 10), e.amount, e.category === "scale" ? ids.tolls : ids.driver, `${e.category[0].toUpperCase()}${e.category.slice(1)} · ${driver}${e.facility ? ` · ${e.facility}` : ""}${load ? ` · load ${load.referenceNumber}` : ""}${e.note ? ` · ${e.note}` : ""}`);
  }

  config.lastSync = new Date(now).toISOString();
  await admin().from("carrier_integrations").update({ config }).eq("carrier_id", ctx.carrier.id).eq("kind", "quickbooks");
  return n;
}

/** Once an hour, for a carrier with QuickBooks connected. */
export async function quickbooksRound(ctx: CarrierContext, links: IntegrationRow[], now: number): Promise<string[]> {
  if (!quickbooksConfigured()) return [];
  const row = links.find((r) => r.kind === "quickbooks");
  if (!row) return [];
  const config = row.config as unknown as QuickbooksConfig;
  if (config.lastSync && now - Date.parse(config.lastSync) < 55 * 60_000) return [];
  try {
    const n = await syncQuickbooks(ctx, config, now);
    const what = [n.invoices && `${n.invoices} invoice${n.invoices === 1 ? "" : "s"}`, n.payments && `${n.payments} payment${n.payments === 1 ? "" : "s"}`, n.costs && `${n.costs} cost${n.costs === 1 ? "" : "s"}`, n.updated && `${n.updated} invoice${n.updated === 1 ? "" : "s"} brought up to date`].filter(Boolean).join(", ");
    await setStatus(ctx.carrier.id, "quickbooks", `Connected${config.companyName ? ` to ${config.companyName}` : ""} · ${what ? `last put in ${what}` : "up to date"}`);
    return what ? [`QuickBooks: ${what}`] : [];
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    await setStatus(ctx.carrier.id, "quickbooks", `Not working: ${reason}`);
    // Intuit let go of the sign-in (100 days unused, or revoked in QuickBooks): the owner hears once, with what to do.
    if (/Connect it again/.test(reason) && (await claimMark(ctx.carrier.id, "quickbooks", `reconnect:${config.connectedAt}`)))
      await passToOwner(ctx, { reason: "QuickBooks needs to be connected again: Intuit ended Backroute's sign-in. Settings → General → Connect QuickBooks. Nothing is lost; what's waiting goes in once it's back.", label: "Got it", source: "app", to: "owner" }).catch(() => 0);
    return [];
  }
}
