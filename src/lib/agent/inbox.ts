import "server-only";
import { messageIdHeader, plainText, type InboundEmail } from "../channels/email";
import { admin, logChannel } from "./db";

/** How an email reached Backroute: sent to the Backroute address, forwarded from the owner's mailbox, or read from it. */
export type EmailVia = "direct" | "forward" | "gmail" | "outlook";

/**
 * Takes in one email for a carrier, however it came: logs it once and says what it is. The same email can arrive
 * twice (forwarding on and the mailbox connected too), so it's matched on its own Message-ID header.
 *
 * Two kinds are for the email setup in Settings, never for the AI: the owner's test ("Backroute test" in the
 * subject), and Gmail's forwarding confirmation, whose code the owner needs to finish turning forwarding on.
 */
export async function takeEmail(carrierId: string, email: InboundEmail, providerId: string, via: EmailVia): Promise<"handle" | "setup" | "seen"> {
  const messageId = messageIdHeader(email);
  if (messageId) {
    const { data } = await admin().from("channel_messages").select("id").eq("carrier_id", carrierId).eq("channel", "email").eq("data->>messageId", messageId).limit(1);
    if (data?.length) return "seen";
  }
  const from = (email.FromFull?.Email ?? email.From).toLowerCase();
  const text = plainText(email);
  const setup = setupMail(from, email.Subject, text);
  const fresh = await logChannel({
    carrierId,
    channel: "email",
    direction: "in",
    providerId,
    counterparty: from,
    body: setup?.kind === "forward_confirm" ? null : text,
    data: { subject: email.Subject, fromName: email.FromName, attachments: (email.Attachments ?? []).map((a) => a.Name), messageId, via, ...setup },
  });
  if (!fresh) return "seen";
  return setup ? "setup" : "handle";
}

/** The owner's own test email, or Gmail asking the Backroute address to confirm forwarding. */
export function setupMail(from: string, subject: string, text: string): { kind: "test" } | { kind: "forward_confirm"; code: string | null; link: string | null } | null {
  if (/\bbackroute test\b/i.test(subject)) return { kind: "test" };
  if (from === "forwarding-noreply@google.com" || /gmail forwarding confirmation/i.test(subject)) {
    const code = text.match(/confirmation code:\s*(\d{6,12})/i)?.[1] ?? subject.match(/\(#(\d{6,12})\)/)?.[1] ?? null;
    const link = text.match(/https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"']+/)?.[0] ?? null;
    return { kind: "forward_confirm", code, link };
  }
  return null;
}

/** How a Postmark delivery got here: written to the Backroute address itself, or forwarded on from another inbox. */
export function viaOf(email: InboundEmail, inboundDomain: string | null): EmailVia {
  if (!inboundDomain) return "direct";
  const to = `${email.To ?? ""}`.toLowerCase();
  return to.includes(`@${inboundDomain.toLowerCase()}`) ? "direct" : "forward";
}
