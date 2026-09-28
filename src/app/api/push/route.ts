import { z } from "zod";
import { admin, dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { pushConfigured, pushToDriver, pushToOffice } from "@/lib/push";

const Sub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("subscribe"), subscription: Sub }),
  z.object({ op: z.literal("unsubscribe"), endpoint: z.string().max(1000) }),
  z.object({ op: z.literal("test"), lang: z.string().max(5).optional() }),
]);

const TEST_DRIVER: Record<string, string> = {
  en: "Notifications are on. Messages from dispatch will show up here.",
  es: "Las notificaciones están activadas. Los mensajes del despacho aparecerán aquí.",
  pa: "ਨੋਟੀਫਿਕੇਸ਼ਨ ਚਾਲੂ ਹਨ। ਡਿਸਪੈਚ ਦੇ ਮੈਸੇਜ ਇੱਥੇ ਦਿਖਣਗੇ।",
  hi: "नोटिफ़िकेशन चालू हैं। डिस्पैच के मैसेज यहाँ दिखेंगे।",
  ru: "Уведомления включены. Сообщения от диспетчера будут появляться здесь.",
  uk: "Сповіщення увімкнено. Повідомлення від диспетчера з'являтимуться тут.",
  fr: "Les notifications sont activées. Les messages de la répartition s'afficheront ici.",
};
const lang = (b: { lang?: string }) => b.lang ?? "en";

/** Phone alerts for the office, and notifications for a driver: turn them on for this device, off, or send a test. */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  if (!pushConfigured()) return Response.json({ error: "push_off" }, { status: 503 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  const db = admin();
  if (b.op === "subscribe") {
    const { error } = await db
      .from("push_subscriptions")
      .upsert({ endpoint: b.subscription.endpoint, user_id: who.me.userId, carrier_id: who.me.carrierId, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth }, { onConflict: "endpoint" });
    return error ? Response.json({ error: "save_failed" }, { status: 500 }) : Response.json({ ok: true });
  }
  if (b.op === "unsubscribe") {
    await db.from("push_subscriptions").delete().eq("endpoint", b.endpoint).eq("user_id", who.me.userId);
    return Response.json({ ok: true });
  }
  const sent =
    who.me.role === "driver"
      ? who.me.driverId
        ? await pushToDriver(who.me.carrierId, who.me.driverId, { title: "Dispatch", body: TEST_DRIVER[lang(b)] ?? TEST_DRIVER.en, url: "/driver", tag: "test" })
        : 0
      : await pushToOffice(who.me.carrierId, { title: "Backroute", body: "Phone alerts are on. You'll hear from us when something needs you.", url: "/carrier", tag: "test" });
  return Response.json({ ok: true, sent });
}
