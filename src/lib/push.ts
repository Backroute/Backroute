import "server-only";
import webpush from "web-push";
import { admin } from "./agent/db";

/**
 * Push notifications to the office's phones and computers (the moment something lands on Needs you), and to drivers'
 * phones (every message from dispatch, a new load, a changed appointment) on top of the text. Keys from
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys). A device that's gone
 * (uninstalled, permission taken back) is forgotten the first time a push to it fails that way.
 */

export const pushConfigured = () => Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@backroute.pro", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  ready = true;
}

interface PushMessage {
  title: string;
  body: string;
  url?: string;
  /** One notification per thing: a newer push with the same tag replaces it. */
  tag?: string;
  urgent?: boolean;
  /** Buttons on the notification (Android, desktop): answered without opening the app, with the signed token. */
  actions?: { action: "yes" | "no"; title: string }[];
  answer?: string;
}

/** To everyone in the carrier's office (owner and dispatchers) who turned on phone alerts. Returns how many got it. */
export async function pushToOffice(carrierId: string, m: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  const { data: office } = await admin().from("members").select("user_id").eq("carrier_id", carrierId).in("role", ["owner", "dispatcher"]);
  return pushTo(carrierId, new Set((office ?? []).map((r) => r.user_id as string)), m);
}

/** To a driver's own phone(s), when they turned on notifications in the driver app. */
export async function pushToDriver(carrierId: string, driverId: string, m: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  const { data: them } = await admin().from("members").select("user_id").eq("carrier_id", carrierId).eq("driver_id", driverId);
  return them?.length ? pushTo(carrierId, new Set(them.map((r) => r.user_id as string)), m) : 0;
}

async function pushTo(carrierId: string, allowed: Set<string>, m: PushMessage): Promise<number> {
  if (!allowed.size) return 0;
  setup();
  const db = admin();
  const { data: subs } = await db.from("push_subscriptions").select("endpoint, user_id, p256dh, auth").eq("carrier_id", carrierId).in("user_id", [...allowed]);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } }, JSON.stringify({ ...m, body: m.body.slice(0, 240) }), { TTL: 6 * 3600, urgency: m.urgent ? "high" : "normal" });
      sent++;
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("[push] couldn't send", status ?? e);
    }
  }
  return sent;
}
