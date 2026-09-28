import { authHeader } from "../ai/client";
import type { PortalTaskView } from "../portal/types";

/** The browser's side of the AI's work on broker websites (api/portal). Passwords only ever go in. */

export interface PortalOverview {
  ready: boolean;
  logins: { id: string; site: string; label: string; username: string | null; twoStep: boolean; updatedAt: string; lastUsedAt: string | null }[];
  answers: { id: string; key: string; label: string; updatedAt: string }[];
  tasks: PortalTaskView[];
}

const REASON: Record<string, string> = {
  owner_only: "Only the owner can do that.",
  bad_site: "Put in the website's address, like mycarrierpackets.com.",
  bad_totp: "That 2-step key doesn't look right. It's the text code shown under the QR code when you turn on an authenticator app.",
  portal_off: "Broker websites aren't switched on for your account yet.",
  nothing_to_approve: "That's already been answered.",
  nothing_asked: "That's already been answered.",
  not_failed: "It's still going.",
};

async function call<T>(method: "GET" | "POST", body?: unknown, query = ""): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`/api/portal${query}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(await authHeader()) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, reason: REASON[data.error ?? ""] ?? "Couldn't do that. Check your connection and try again." };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "Couldn't do that. Check your connection and try again." };
  }
}

export const portalOverview = () => call<PortalOverview>("GET");
export const portalTask = (id: string) => call<{ task: PortalTaskView; question?: string }>("GET", undefined, `?task=${encodeURIComponent(id)}`);
export const portalAct = (body: Record<string, unknown>) => call<{ ok: true; status?: string; site?: string }>("POST", body);
