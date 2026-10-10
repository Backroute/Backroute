import { dbConfigured } from "@/lib/agent/db";
import { integrationsFor, removeIntegration } from "@/lib/agent/integrations";
import { disconnectMailbox, mailboxConfigured, mailboxConnectUrl, type MailboxConfig, type MailboxKind } from "@/lib/agent/mailbox";
import { caller } from "@/lib/agent/user";

/**
 * The owner's mailbox (Gmail or Outlook), read for broker mail: GET says which can be connected and which is,
 * POST ?kind= starts connecting (the app sends them to Google's or Microsoft's page), DELETE disconnects. Owner only.
 */

const kindOf = (request: Request): MailboxKind | null => {
  const k = new URL(request.url).searchParams.get("kind");
  return k === "gmail" || k === "outlook" ? k : null;
};

async function owner(request: Request) {
  if (!dbConfigured()) return { error: Response.json({ error: "not_set_up" }, { status: 503 }) };
  const who = await caller(request);
  if (!who || who.me.role !== "owner") return { error: Response.json({ error: "sign_in" }, { status: 401 }) };
  return { who };
}

export async function GET(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  const row = (await integrationsFor(o.who.me.carrierId)).find((r) => r.kind === "gmail" || r.kind === "outlook");
  const config = row?.config as MailboxConfig | undefined;
  return Response.json({
    available: { gmail: mailboxConfigured("gmail"), outlook: mailboxConfigured("outlook") },
    connected: row && config ? { kind: row.kind, email: config.email, status: row.status, lastChecked: config.lastChecked ?? null, taken: config.taken ?? 0 } : null,
  });
}

export async function POST(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  const kind = kindOf(request);
  if (!kind) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!mailboxConfigured(kind)) return Response.json({ error: "mailbox_off" }, { status: 503 });
  return Response.json({ url: mailboxConnectUrl(kind, o.who.me.carrierId, o.who.me.userId) });
}

export async function DELETE(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  const kind = kindOf(request);
  if (!kind) return Response.json({ error: "bad_request" }, { status: 400 });
  const row = (await integrationsFor(o.who.me.carrierId)).find((r) => r.kind === kind);
  if (row) await disconnectMailbox(o.who.me.carrierId, kind, row.config as MailboxConfig).catch(() => 0);
  await removeIntegration(o.who.me.carrierId, kind);
  return Response.json({ ok: true });
}
