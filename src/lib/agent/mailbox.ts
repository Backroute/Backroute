import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { InboundEmail } from "../channels/email";
import { open, seal, vaultConfigured } from "../portal/vault";
import { admin, claimMark, type CarrierContext } from "./db";
import { handleInboundEmail } from "./email";
import { takeEmail } from "./inbox";
import { saveIntegration, setStatus, type IntegrationRow } from "./integrations";
import { passToOwner } from "./dispatcher";

/**
 * The owner's own mailbox, read for broker mail: brokers keep emailing the address they already have (the one on the
 * carrier's broker setup profiles), and rate cons still reach Backroute first, with no forwarding to set up.
 *
 * Gmail (read-only) or Outlook / Microsoft 365 (Mail.Read). Every few minutes the new mail since the last look is
 * listed; only freight mail is kept (from a broker the carrier works with, or about a load: a rate con, a tender, a
 * BOL, setup papers, a payment), and that goes through the same path as an email to the Backroute address. Everything
 * else is skipped where it lies: not stored, not shown to the AI. Nothing is sent from the mailbox or changed in it.
 *
 * Backroute's apps: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET and MS_CLIENT_ID/MS_CLIENT_SECRET, each with
 * PUBLIC_BASE_URL/api/integrations/mailbox/callback as its redirect address. The mailbox's sign-in is sealed
 * (PORTAL_VAULT_KEY). Google treats gmail.readonly as a restricted scope: until the app passes Google's review
 * (with a yearly security assessment), only test users added in the Google console can connect. See docs/email.md.
 */

export type MailboxKind = "gmail" | "outlook";

export interface MailboxConfig {
  /** The mailbox's own address. */
  email: string;
  /** The mailbox's sign-in for Backroute (a refresh token), sealed. */
  refresh: string;
  connectedAt: string;
  /** New mail is looked for from here (ISO time); a little overlap, as the same email is only taken once. */
  since: string;
  lastChecked?: string;
  /** Freight emails taken in so far. */
  taken?: number;
}

class MailboxError extends Error {}

const env = (k: string) => process.env[k];
const P = {
  gmail: {
    id: () => env("GOOGLE_CLIENT_ID"),
    secret: () => env("GOOGLE_CLIENT_SECRET"),
    auth: () => env("GOOGLE_AUTH_URL") ?? "https://accounts.google.com/o/oauth2/v2/auth",
    token: () => env("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token",
    revoke: () => env("GOOGLE_REVOKE_URL") ?? "https://oauth2.googleapis.com/revoke",
    api: () => (env("GMAIL_API_BASE") ?? "https://gmail.googleapis.com").replace(/\/$/, ""),
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    name: "Gmail",
  },
  outlook: {
    id: () => env("MS_CLIENT_ID"),
    secret: () => env("MS_CLIENT_SECRET"),
    auth: () => env("MS_AUTH_URL") ?? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: () => env("MS_TOKEN_URL") ?? "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revoke: () => null,
    api: () => (env("GRAPH_API_BASE") ?? "https://graph.microsoft.com").replace(/\/$/, ""),
    scope: "offline_access User.Read Mail.Read",
    name: "Outlook",
  },
} as const;

export const mailboxConfigured = (kind: MailboxKind) => Boolean(P[kind].id() && P[kind].secret() && process.env.PUBLIC_BASE_URL && vaultConfigured());
const REDIRECT = () => `${process.env.PUBLIC_BASE_URL!.replace(/\/$/, "")}/api/integrations/mailbox/callback`;

// ─── Connecting ──────────────────────────────────────────────────────────────

const stateKey = () => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("backroute-mailbox-connect").digest();
const signState = (body: string) => createHmac("sha256", stateKey()).update(body).digest("base64url");

/** Google's or Microsoft's sign-in page, with a signed note of who asked and for which mailbox (good 15 minutes). */
export function mailboxConnectUrl(kind: MailboxKind, carrierId: string, userId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ k: kind, c: carrierId, u: userId, x: Math.floor(now / 1000) + 15 * 60 })).toString("base64url");
  const q = new URLSearchParams({ client_id: P[kind].id()!, response_type: "code", scope: P[kind].scope, redirect_uri: REDIRECT(), state: `${body}.${signState(body)}` });
  if (kind === "gmail") {
    q.set("access_type", "offline");
    q.set("prompt", "consent");
    q.set("include_granted_scopes", "true");
  } else q.set("prompt", "select_account");
  return `${P[kind].auth()}?${q}`;
}

export function readMailboxState(state: string, now = Date.now()): { kind: MailboxKind; carrierId: string; userId: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(signState(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { k?: string; c?: string; u?: string; x?: number };
    if ((p.k !== "gmail" && p.k !== "outlook") || !p.c || !p.u || !p.x || p.x * 1000 < now) return null;
    return { kind: p.k, carrierId: p.c, userId: p.u };
  } catch {
    return null;
  }
}

async function tokens(kind: MailboxKind, form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(P[kind].token(), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: P[kind].id()!, client_secret: P[kind].secret()!, ...(kind === "outlook" ? { scope: P.outlook.scope } : {}) }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new MailboxError(body.error === "invalid_grant" ? `${P[kind].name} sign-in ended. Connect it again.` : `${P[kind].name} sign-in failed (${res.status}).`);
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in ?? 3600 };
}

const bind = (carrierId: string, kind: MailboxKind) => `${carrierId}|mailbox|${kind}`;
const access = new Map<string, { token: string; until: number }>();

async function api<T>(kind: MailboxKind, token: string, path: string): Promise<T> {
  const res = await fetch(`${P[kind].api()}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(kind === "outlook" ? { prefer: 'outlook.body-content-type="text"' } : {}) }, signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (res.status === 401) throw new MailboxError(`${P[kind].name} sign-in ended. Connect it again.`);
  if (!res.ok) throw new MailboxError(`${P[kind].name} answered ${res.status}.`);
  return (await res.json()) as T;
}

/** Google or Microsoft sent the owner back with a code: trade it for the mailbox's sign-in and keep it, sealed. */
export async function finishMailboxConnect(kind: MailboxKind, carrierId: string, code: string, now = Date.now()): Promise<MailboxConfig> {
  const t = await tokens(kind, { grant_type: "authorization_code", code, redirect_uri: REDIRECT() });
  if (!t.refresh_token) throw new MailboxError(`${P[kind].name} didn't give Backroute lasting access. Try connecting again.`);
  access.set(`${carrierId}:${kind}`, { token: t.access_token, until: now + (t.expires_in - 120) * 1000 });
  const email =
    kind === "gmail"
      ? (await api<{ emailAddress?: string }>(kind, t.access_token, "/gmail/v1/users/me/profile")).emailAddress
      : await api<{ mail?: string | null; userPrincipalName?: string }>(kind, t.access_token, "/v1.0/me").then((m) => m.mail ?? m.userPrincipalName);
  if (!email) throw new MailboxError(`${P[kind].name} didn't say which mailbox this is.`);
  const config: MailboxConfig = { email: email.toLowerCase(), refresh: seal(t.refresh_token, bind(carrierId, kind)), connectedAt: new Date(now).toISOString(), since: new Date(now - 10 * 60_000).toISOString() };
  // One mailbox at a time: connecting Outlook lets go of Gmail and the other way round.
  await admin().from("carrier_integrations").delete().eq("carrier_id", carrierId).eq("kind", kind === "gmail" ? "outlook" : "gmail");
  await saveIntegration(carrierId, kind, config, `Connected to ${config.email} · reading broker mail`);
  return config;
}

export async function disconnectMailbox(carrierId: string, kind: MailboxKind, config: MailboxConfig) {
  const refresh = open(config.refresh, bind(carrierId, kind))?.value;
  const revoke = P[kind].revoke();
  if (refresh && revoke) await fetch(`${revoke}?token=${encodeURIComponent(refresh)}`, { method: "POST", signal: AbortSignal.timeout(10000) }).catch(() => 0);
  access.delete(`${carrierId}:${kind}`);
}

async function accessToken(carrierId: string, kind: MailboxKind, config: MailboxConfig): Promise<string> {
  const hit = access.get(`${carrierId}:${kind}`);
  if (hit && hit.until > Date.now()) return hit.token;
  const refresh = open(config.refresh, bind(carrierId, kind));
  if (!refresh) throw new MailboxError(`${P[kind].name} sign-in can't be read. Connect it again.`);
  const t = await tokens(kind, { grant_type: "refresh_token", refresh_token: refresh.value });
  access.set(`${carrierId}:${kind}`, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  // Microsoft hands out a new sign-in as the old one is used: keep it (and re-seal with today's key).
  if ((t.refresh_token && t.refresh_token !== refresh.value) || refresh.stale) config.refresh = seal(t.refresh_token ?? refresh.value, bind(carrierId, kind));
  return t.access_token;
}

// ─── Which mail is freight ───────────────────────────────────────────────────

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "aol.com", "icloud.com", "me.com", "msn.com", "proton.me", "protonmail.com"]);
const FREIGHT = /\b(rate ?con(firmation)?s?|load (tender|confirmation|offer)s?|tender(ed)?|carrier (packet|setup|agreement)|setup packet|bol|bill of lading|pod|proof of delivery|lumper|detention|layover|tonu|remittance|quick ?pay|dispatch sheet|pick ?up #|load ?#|pro ?#|backroute test)\b/i;
const domainOf = (address: string) => address.split("@")[1]?.toLowerCase() ?? "";

/**
 * Whether an email in the owner's mailbox is for Backroute: from a broker the carrier works with (their address, or
 * their company's domain), or about freight in its subject or its file names. Personal mail, bank mail, newsletters:
 * no. The owner's own sent mail is never read.
 */
export function isFreightMail(m: { from: string; subject: string; attachments: string[] }, brokerEmails: string[], own: string): boolean {
  const from = m.from.toLowerCase();
  if (from === own.toLowerCase() && !/\bbackroute test\b/i.test(m.subject)) return false;
  const domain = domainOf(from);
  const brokers = brokerEmails.map((e) => e.toLowerCase());
  if (brokers.includes(from)) return true;
  if (domain && !FREE_MAIL.has(domain) && brokers.some((b) => domainOf(b) === domain)) return true;
  return FREIGHT.test(m.subject) || m.attachments.some((a) => FREIGHT.test(a.replace(/[_.-]+/g, " ")));
}

// ─── Reading ─────────────────────────────────────────────────────────────────

interface Found {
  id: string;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  attachments: string[];
  /** The whole email, fetched only when it's freight. */
  full: () => Promise<InboundEmail>;
}

type GmailPart = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const flat = (p: GmailPart): GmailPart[] => [p, ...(p.parts ?? []).flatMap(flat)];
const addr = (v: string) => (v.match(/<([^>]+)>/)?.[1] ?? v).trim().toLowerCase();
const nameOf = (v: string) => v.match(/^\s*"?([^"<]+?)"?\s*</)?.[1];

async function gmailNew(token: string, since: string): Promise<Found[]> {
  const q = encodeURIComponent(`after:${Math.floor(Date.parse(since) / 1000)} -in:sent -in:chats -in:spam -in:trash`);
  const list = await api<{ messages?: { id: string }[] }>("gmail", token, `/gmail/v1/users/me/messages?q=${q}&maxResults=50`);
  const out: Found[] = [];
  for (const { id } of list.messages ?? []) {
    const m = await api<{ id: string; payload?: GmailPart }>("gmail", token, `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
    const root = m.payload ?? {};
    const h = (n: string) => root.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const parts = flat(root);
    const files = parts.filter((p) => p.filename && p.body?.attachmentId);
    out.push({
      id,
      from: addr(h("from")),
      fromName: nameOf(h("from")),
      to: h("to"),
      subject: h("subject"),
      attachments: files.map((p) => p.filename!),
      full: async () => {
        const text = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
        const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
        const attachments = [];
        for (const f of files.slice(0, 10)) {
          if ((f.body?.size ?? 0) > 15_000_000) continue;
          const a = await api<{ data: string; size?: number }>("gmail", token, `/gmail/v1/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(f.body!.attachmentId!)}`);
          const bytes = b64(a.data);
          attachments.push({ Name: f.filename!, Content: bytes.toString("base64"), ContentType: f.mimeType ?? "application/octet-stream", ContentLength: bytes.length });
        }
        return {
          MessageID: `gmail:${id}`,
          From: addr(h("from")),
          FromName: nameOf(h("from")),
          To: h("to"),
          Subject: h("subject"),
          TextBody: text ? b64(text.body!.data!).toString("utf8") : undefined,
          HtmlBody: html ? b64(html.body!.data!).toString("utf8") : undefined,
          Headers: (root.headers ?? []).filter((x) => /^(message-id|in-reply-to|references)$/i.test(x.name)).map((x) => ({ Name: x.name, Value: x.value })),
          Attachments: attachments,
        };
      },
    });
  }
  return out;
}

type GraphMail = {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  body?: { contentType?: string; content?: string };
  internetMessageId?: string;
  internetMessageHeaders?: { name: string; value: string }[];
  hasAttachments?: boolean;
};

async function outlookNew(token: string, since: string): Promise<Found[]> {
  const filter = encodeURIComponent(`receivedDateTime ge ${new Date(since).toISOString()}`);
  const select = "id,subject,from,toRecipients,body,internetMessageId,hasAttachments,receivedDateTime";
  const list = await api<{ value?: GraphMail[] }>("outlook", token, `/v1.0/me/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime%20asc&$top=50&$select=${select}`);
  const out: Found[] = [];
  for (const m of list.value ?? []) {
    let names: string[] = [];
    let files: { name: string; contentType?: string; contentBytes?: string; size?: number; "@odata.type"?: string }[] = [];
    if (m.hasAttachments) {
      files = (await api<{ value?: typeof files }>("outlook", token, `/v1.0/me/messages/${encodeURIComponent(m.id)}/attachments`)).value ?? [];
      files = files.filter((f) => (f["@odata.type"] ?? "#microsoft.graph.fileAttachment") === "#microsoft.graph.fileAttachment");
      names = files.map((f) => f.name);
    }
    const from = (m.from?.emailAddress?.address ?? "").toLowerCase();
    out.push({
      id: m.id,
      from,
      fromName: m.from?.emailAddress?.name,
      to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean).join(", "),
      subject: m.subject ?? "",
      attachments: names,
      full: async () => ({
        MessageID: `outlook:${m.id}`,
        From: from,
        FromName: m.from?.emailAddress?.name,
        To: (m.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean).join(", "),
        Subject: m.subject ?? "",
        ...(m.body?.contentType === "html" ? { HtmlBody: m.body.content } : { TextBody: m.body?.content }),
        Headers: m.internetMessageId ? [{ Name: "Message-ID", Value: m.internetMessageId }] : [],
        Attachments: files.filter((f) => f.contentBytes && (f.size ?? 0) <= 15_000_000).slice(0, 10).map((f) => ({ Name: f.name, Content: f.contentBytes!, ContentType: f.contentType ?? "application/octet-stream", ContentLength: f.size ?? 0 })),
      }),
    });
  }
  return out;
}

/** Looks at the mail that's come in since the last look and takes in the freight mail. Returns how many it took. */
export async function readMailbox(ctx: CarrierContext, kind: MailboxKind, config: MailboxConfig, now = Date.now()): Promise<number> {
  const token = await accessToken(ctx.carrier.id, kind, config);
  const found = kind === "gmail" ? await gmailNew(token, config.since) : await outlookNew(token, config.since);
  const brokers = ctx.brokers.map((b) => b.email).filter((e): e is string => !!e);
  let taken = 0;
  for (const f of found) {
    if (!isFreightMail(f, brokers, config.email)) continue;
    const email = await f.full();
    if ((await takeEmail(ctx.carrier.id, email, email.MessageID, kind)) === "handle") {
      await handleInboundEmail(ctx.carrier.id, email).catch((e) => console.error("[mailbox] handling failed", e));
      taken++;
    }
  }
  // Two minutes of overlap: mail can show up in the list a little after the time it says it arrived.
  config.since = new Date(now - 2 * 60_000).toISOString();
  config.lastChecked = new Date(now).toISOString();
  config.taken = (config.taken ?? 0) + taken;
  return taken;
}

/** Every round: the connected mailbox, read for freight mail. */
export async function mailboxRound(ctx: CarrierContext, links: IntegrationRow[], now: number): Promise<string[]> {
  const row = links.find((r) => r.kind === "gmail" || r.kind === "outlook");
  if (!row) return [];
  const kind = row.kind as MailboxKind;
  if (!mailboxConfigured(kind)) return [];
  const config = row.config as unknown as MailboxConfig;
  try {
    const n = await readMailbox(ctx, kind, config, now);
    await admin().from("carrier_integrations").update({ config, status: `Connected to ${config.email} · ${config.taken ?? 0} broker email${config.taken === 1 ? "" : "s"} taken in`, checked_at: new Date(now).toISOString() }).eq("carrier_id", ctx.carrier.id).eq("kind", kind);
    return n ? [`${n} broker email${n === 1 ? "" : "s"} from ${config.email}`] : [];
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    await setStatus(ctx.carrier.id, kind, `Not working: ${reason}`);
    if (/Connect it again/.test(reason) && (await claimMark(ctx.carrier.id, "mailbox", `reconnect:${config.connectedAt}`)))
      await passToOwner(ctx, { reason: `${P[kind].name} needs to be connected again: Backroute can't read ${config.email} for broker mail. Settings → Phone, text and email → Connect ${P[kind].name}.`, label: "Got it", source: "app", to: "owner" }).catch(() => 0);
    return [];
  }
}
