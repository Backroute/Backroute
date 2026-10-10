import { dbConfigured } from "@/lib/agent/db";
import { finishMailboxConnect, mailboxConfigured, readMailboxState } from "@/lib/agent/mailbox";

/**
 * Google or Microsoft sends the owner back here after they let Backroute read their mailbox. The signed state says
 * which carrier asked and for which mailbox (and expires in 15 minutes); the code is traded for a sign-in, kept sealed.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => Response.redirect(new URL(`/carrier/settings?tab=general&mailbox=${result}#set-channels`, process.env.PUBLIC_BASE_URL ?? url.origin), 303);
  if (!dbConfigured()) return back("off");
  const who = readMailboxState(url.searchParams.get("state") ?? "");
  if (!who) return back("expired");
  if (!mailboxConfigured(who.kind)) return back("off");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return back("cancelled");
  try {
    await finishMailboxConnect(who.kind, who.carrierId, code);
    return back("connected");
  } catch (e) {
    console.error("[mailbox] connect failed", e);
    return back("failed");
  }
}
