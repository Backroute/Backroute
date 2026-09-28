import "server-only";
import { admin } from "../agent/db";
import type { Driver } from "../types";
import { sendSms, sendWhatsApp, sendWhatsAppTemplate, whatsappConfigured, whatsappTemplate } from "./twilio";

/**
 * Which way a text goes: SMS or WhatsApp. People answer where they already are, so a driver who writes on WhatsApp is
 * answered on WhatsApp, and one who picked WhatsApp in the app hears from dispatch there. WhatsApp only takes a
 * free-form message within 24 hours of the person's last one; after that it's the approved template if there is one,
 * or plain SMS, so nothing is ever lost to the window.
 */

export type Via = "sms" | "whatsapp";

const WINDOW = 24 * 3600_000 - 5 * 60_000;
export const last10 = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/** Someone texted us: remember which way, so the answer (and what follows) goes back the same way. */
export async function noteInbound(phone: string, via: Via) {
  const key = last10(phone);
  if (key.length !== 10) return;
  const at = new Date().toISOString();
  await admin()
    .from("text_routes")
    .upsert({ phone_last10: key, [via === "whatsapp" ? "whatsapp_at" : "sms_at"]: at, updated_at: at }, { onConflict: "phone_last10" })
    .then(({ error }) => error && console.error("[texting] couldn't note the route", error.message));
}

export interface Route {
  via: Via;
  /** WhatsApp's 24 hours are open: a free-form message can go. */
  open: boolean;
}

/** How to reach a number right now. */
export async function routeFor(phone: string, now = Date.now()): Promise<Route> {
  if (!whatsappConfigured()) return { via: "sms", open: false };
  const key = last10(phone);
  const [{ data: row }, { data: drivers }] = await Promise.all([
    admin().from("text_routes").select("whatsapp_at, sms_at").eq("phone_last10", key).maybeSingle(),
    admin().from("drivers").select("data").eq("phone_last10", key).limit(5),
  ]);
  const wa = row?.whatsapp_at ? Date.parse(row.whatsapp_at as string) : 0;
  const sms = row?.sms_at ? Date.parse(row.sms_at as string) : 0;
  const picked = (drivers ?? []).map((d) => (d.data as Driver).prefs?.textsBy).find(Boolean);
  // Their own pick in the app wins; otherwise whichever way they last wrote.
  const via: Via = picked ?? (wa > sms ? "whatsapp" : "sms");
  return { via, open: via === "whatsapp" && wa > 0 && now - wa < WINDOW };
}

/** A 4xx from Twilio on WhatsApp (not on WhatsApp, outside the window, template refused): SMS will do instead. */
const refused = (e: unknown) => {
  const status = Number((e instanceof Error ? e.message : String(e)).match(/^Twilio (\d{3})/)?.[1]);
  return status >= 400 && status < 500;
};

/**
 * Sends a text the way this person gets their texts. `media` (a public URL) rides along on WhatsApp only: a voice
 * answer to a voice message. Returns the provider's id and which way it went.
 */
export async function sendText(to: string, body: string, media: string[] = []): Promise<{ sid: string | undefined; via: Via }> {
  const route = await routeFor(to).catch(() => ({ via: "sms", open: false }) as Route);
  if (route.via === "whatsapp") {
    try {
      if (route.open) return { sid: await sendWhatsApp(to, body, media), via: "whatsapp" };
      if (whatsappTemplate()) return { sid: await sendWhatsAppTemplate(to, body), via: "whatsapp" };
    } catch (e) {
      if (!refused(e)) throw e;
      console.error("[texting] WhatsApp refused it, sending by SMS", e);
    }
  }
  return { sid: await sendSms(to, body), via: "sms" };
}
