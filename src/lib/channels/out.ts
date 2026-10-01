import "server-only";
import { admin } from "../agent/db";
import type { AgentSettings } from "../store";
import { emailConfigured, sendEmail, type Attachment } from "./email";
import { canCallOut, startCall, twilioConfigured } from "./twilio";
import { sendText } from "./texting";
import { recipientPolicy, type Recipient } from "../consent";

/**
 * The one way a text, email or call leaves Backroute for a carrier. Everything the AI (or support) sends goes through
 * here, which is what makes two promises hold:
 *
 * - Sandbox mode (a shadow week, or the simulated brokers and drivers): nothing leaves. Each message is kept in the
 *   outbound table as "held", so the owner sees what the AI would have sent and the simulator can answer it.
 * - A provider outage doesn't lose a message: a text or email that fails is kept as "retry" and the dispatcher's
 *   rounds send it again (retryOutbound). Calls aren't retried: a call an hour late is worse than the text or email
 *   each caller already falls back to.
 *
 * Returns the provider's id, or "held:<id>" / "queued:<id>". Throws only when a call fails, or when even keeping the
 * message fails (the database is down too).
 */

export interface Sender {
  id: string;
  settings?: Partial<Pick<AgentSettings, "sandbox">> | null;
}

export const sandboxed = (c: Sender | null | undefined) => Boolean(c?.settings?.sandbox);

/** Whether this carrier can text, email or call out: a provider is set up, or it's in sandbox (nothing leaves). */
export const canText = (c: Sender | null) => sandboxed(c) || twilioConfigured();
export const canEmail = (c: Sender) => sandboxed(c) || emailConfigured();
export const canCall = (c: Sender) => sandboxed(c) || canCallOut();

/** How long a failed message is still worth sending. */
const FRESH_FOR: Record<"sms" | "email", number> = { sms: 30 * 60_000, email: 24 * 3600_000 };
const BACKOFF = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

async function keep(c: Sender, row: { channel: "sms" | "voice" | "email"; recipient: string; subject?: string; body?: string; data?: Record<string, unknown>; status: "held" | "retry"; error?: string }) {
  const { data, error } = await admin()
    .from("outbound")
    .insert({
      carrier_id: c.id,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject ?? null,
      body: row.body ?? null,
      data: row.data ?? {},
      status: row.status,
      attempts: row.status === "retry" ? 1 : 0,
      next_at: row.status === "retry" ? new Date(Date.now() + BACKOFF[0]).toISOString() : null,
      last_error: row.error ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return `${row.status === "held" ? "held" : "queued"}:${data.id as string}`;
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Worth trying again: the provider was down, slow or busy. A bad number or address fails the same way every time. */
function retriable(e: unknown): boolean {
  const status = Number(reason(e).match(/^(?:Twilio|Postmark) (\d{3})/)?.[1]);
  return !status || status >= 500 || status === 429;
}

/**
 * A text, by SMS or WhatsApp, whichever way this person texts (lib/channels/texting). `c` is null only for
 * Backroute's own texts to its support team. `media` (a public link) goes along on WhatsApp: a spoken answer.
 */
export async function textTo(c: Sender | null, to: string, body: string, opts: { media?: string[] } = {}): Promise<string> {
  if (c && sandboxed(c)) return keep(c, { channel: "sms", recipient: to, body, status: "held" });
  // Who this is to decides how it goes (lib/consent): the first-text notice, a hold for their yes, or the app instead.
  const policy: Recipient | null = c ? await recipientPolicy(c.id, to).catch((e) => (console.error("[out] consent check failed", e), null)) : null;
  try {
    if (policy?.notice) await sendText(to, policy.notice).catch((e) => console.error("[out] first text failed", e));
    if (c && policy?.hold && policy.driverId) {
      const id = await keep(c, { channel: "sms", recipient: to, body, data: { reason: "no_consent", driverId: policy.driverId }, status: "held" });
      await heldForYes(c.id, policy.driverId).catch((e) => console.error("[out] couldn't tell the office about a held text", e));
      return id;
    }
    if (c && policy?.appOnly && policy.driverId) {
      const { pushToDriver } = await import("../push");
      // Same tag as the message in their thread, so it's one notification, not two.
      const n = await pushToDriver(c.id, policy.driverId, { title: "Dispatch", body, url: "/driver/messages", tag: `dm-${policy.driverId}` }).catch(() => 0);
      if (n) return `app:${policy.driverId}`;
    }
    return (await sendText(to, body, opts.media)).sid ?? "";
  } catch (e) {
    if (!c || !retriable(e)) throw e;
    console.error("[out] text failed, will retry", e);
    return keep(c, { channel: "sms", recipient: to, body, status: "retry", error: reason(e) });
  }
}

/** Tells the office once that a driver's texts are waiting for their yes, and how to get it. */
async function heldForYes(carrierId: string, driverId: string) {
  const { claimMark, addActivity } = await import("../agent/db");
  if (!(await claimMark(carrierId, `driver:${driverId}`, "consent_hold"))) return;
  const { event } = await import("../agent/dispatcher");
  const { pushToOffice } = await import("../push");
  const message = "A driver's texts are waiting for their OK";
  const detail = "They haven't agreed to texts from dispatch yet, so nothing goes to them until they answer YES to the first text or agree in the driver app. Or, if they told you they agree, say so in Settings, under driver texts.";
  await addActivity(carrierId, event({ type: "escalation", message, detail, severity: "warning" }));
  await pushToOffice(carrierId, { title: message, body: detail, url: "/carrier/settings", tag: `consent-${driverId}` }).catch(() => 0);
}

export interface EmailOut {
  to: string;
  subject: string;
  text: string;
  fromName: string;
  inReplyTo?: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export async function emailTo(c: Sender, p: EmailOut): Promise<string> {
  const meta = { fromName: p.fromName, inReplyTo: p.inReplyTo, replyTo: p.replyTo };
  if (sandboxed(c)) return keep(c, { channel: "email", recipient: p.to, subject: p.subject, body: p.text, data: { ...meta, attachments: (p.attachments ?? []).map((a) => a.name) }, status: "held" });
  try {
    return (await sendEmail(p)) ?? "";
  } catch (e) {
    if (!retriable(e)) throw e;
    console.error("[out] email failed, will retry", e);
    return keep(c, { channel: "email", recipient: p.to, subject: p.subject, body: p.text, data: { ...meta, files: p.attachments ?? [] }, status: "retry", error: reason(e) });
  }
}

/** Backroute's own email to its team (a system alert): no carrier, nothing kept to retry. Returns false when it can't go. */
export async function emailOurTeam(to: string, subject: string, text: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    await sendEmail({ to, subject, text, fromName: "Backroute alerts" });
    return true;
  } catch (e) {
    console.error("[out] alert email failed", e);
    return false;
  }
}

/**
 * Rings someone. `call` says what the call is for, so a held call can be played by the simulator (and shown to the
 * owner): the kind of call and what it's about (a load, a truck).
 */
export async function callTo(c: Sender, to: string, url: string | null, call: { kind: string; ref: string; opening?: string; machineDetection?: boolean }): Promise<string> {
  if (sandboxed(c)) return keep(c, { channel: "voice", recipient: to, body: call.opening, data: { kind: call.kind, ref: call.ref, url }, status: "held" });
  if (!url) throw new Error("No public address for the call (set PUBLIC_BASE_URL).");
  return (await startCall(to, url, { machineDetection: call.machineDetection })) ?? "";
}

/** Whether an id from textTo / emailTo / callTo is a real send (not held or waiting to retry). */
export const wentOut = (id: string | null | undefined) => !!id && !id.startsWith("held:") && !id.startsWith("queued:");

/**
 * The dispatcher's rounds: sends again what failed, oldest first, with backoff. Gives up on a text after 30 minutes
 * and an email after a day, and says so, so support can see it.
 */
export interface GaveUp {
  carrierId: string;
  channel: "sms" | "email";
  recipient: string;
  subject: string | null;
  body: string | null;
}

export async function retryOutbound(now = Date.now(), limit = 50): Promise<{ sent: number; gaveUp: GaveUp[] }> {
  const { data, error } = await admin().from("outbound").select("id, carrier_id, channel, recipient, subject, body, data, attempts, created_at").eq("status", "retry").lte("next_at", new Date(now).toISOString()).order("created_at").limit(limit);
  if (error) throw error;
  let sent = 0;
  const gaveUp: GaveUp[] = [];
  const lost = (row: Record<string, unknown>) => gaveUp.push({ carrierId: row.carrier_id as string, channel: row.channel as "sms" | "email", recipient: row.recipient as string, subject: (row.subject as string) ?? null, body: (row.body as string) ?? null });
  for (const row of data ?? []) {
    const channel = row.channel as "sms" | "email";
    const age = now - Date.parse(row.created_at as string);
    if (age > FRESH_FOR[channel]) {
      await admin().from("outbound").update({ status: "gave_up", next_at: null }).eq("id", row.id);
      lost(row);
      continue;
    }
    try {
      const d = (row.data ?? {}) as { fromName?: string; inReplyTo?: string; replyTo?: string; files?: Attachment[] };
      const id =
        channel === "sms"
          ? (await sendText(row.recipient as string, (row.body as string) ?? "")).sid
          : await sendEmail({ to: row.recipient as string, subject: (row.subject as string) ?? "", text: (row.body as string) ?? "", fromName: d.fromName ?? "Dispatch", inReplyTo: d.inReplyTo, replyTo: d.replyTo, attachments: d.files });
      await admin().from("outbound").update({ status: "sent", next_at: null, attempts: (row.attempts as number) + 1, data: { ...(row.data as object), files: undefined, providerId: id ?? null } }).eq("id", row.id);
      sent++;
    } catch (e) {
      const attempts = (row.attempts as number) + 1;
      if (!retriable(e)) {
        await admin().from("outbound").update({ status: "gave_up", attempts, last_error: reason(e), next_at: null }).eq("id", row.id);
        lost(row);
        continue;
      }
      const wait = BACKOFF[Math.min(attempts, BACKOFF.length - 1)];
      await admin().from("outbound").update({ attempts, last_error: reason(e), next_at: new Date(now + wait).toISOString() }).eq("id", row.id);
    }
  }
  return { sent, gaveUp };
}
