import "server-only";

/**
 * Email through Postmark: brokers write to the carrier's Backroute address, and replies the owner approves go out
 * from the carrier's verified sender. Off unless POSTMARK_SERVER_TOKEN and EMAIL_FROM are set.
 */

export const emailConfigured = () => Boolean(process.env.POSTMARK_SERVER_TOKEN && process.env.EMAIL_FROM);

/** The address brokers write to for one carrier: Postmark's inbound address with the carrier's key after a "+". */
export function inboundAddress(inboundKey: string): string | null {
  const base = process.env.EMAIL_INBOUND_ADDRESS; // e.g. abc123@inbound.postmarkapp.com
  if (!base) return null;
  const [user, domain] = base.split("@");
  return `${user}+${inboundKey}@${domain}`;
}

/** Postmark's inbound webhook body, the parts used here. */
export interface InboundEmail {
  MessageID: string;
  From: string;
  FromName?: string;
  FromFull?: { Email: string; Name?: string };
  To: string;
  MailboxHash?: string;
  Subject: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Headers?: { Name: string; Value: string }[];
  Attachments?: { Name: string; Content: string; ContentType: string; ContentLength: number }[];
}

/** The email's own Message-ID header, which a reply needs to thread. */
export function messageIdHeader(email: InboundEmail): string | undefined {
  return email.Headers?.find((h) => h.Name.toLowerCase() === "message-id")?.Value;
}

export function plainText(email: InboundEmail): string {
  const text = email.StrippedTextReply || email.TextBody || (email.HtmlBody ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
}

export interface Attachment {
  name: string;
  contentType: string;
  /** Base64. */
  content: string;
}

export async function sendEmail(p: { to: string; subject: string; text: string; fromName: string; inReplyTo?: string; replyTo?: string; attachments?: Attachment[] }) {
  const base = process.env.POSTMARK_API_BASE?.replace(/\/$/, "") ?? "https://api.postmarkapp.com";
  const res = await fetch(`${base}/email`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-postmark-server-token": process.env.POSTMARK_SERVER_TOKEN! },
    body: JSON.stringify({
      From: `${p.fromName.replace(/[<>"]/g, "")} <${process.env.EMAIL_FROM}>`,
      To: p.to,
      Subject: p.subject,
      TextBody: p.text,
      ...(p.replyTo ? { ReplyTo: p.replyTo } : {}),
      ...(p.inReplyTo ? { Headers: [{ Name: "In-Reply-To", Value: p.inReplyTo }, { Name: "References", Value: p.inReplyTo }] } : {}),
      ...(p.attachments?.length ? { Attachments: p.attachments.map((a) => ({ Name: a.name, Content: a.content, ContentType: a.contentType })) } : {}),
      MessageStream: "outbound",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string; ErrorCode?: number };
  if (!res.ok || (data.ErrorCode && data.ErrorCode !== 0)) throw new Error(`Postmark ${res.status}: ${data.Message ?? "error"}`);
  return data.MessageID;
}
