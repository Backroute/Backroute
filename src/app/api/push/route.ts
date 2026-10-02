import { z } from "zod";
import { admin, dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { pushConfigured, pushToDriver, pushToOffice } from "@/lib/push";

const Sub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("subscribe"), subscription: Sub }),
  z.object({ op: z.literal("unsubscribe"), endpoint: z.string().max(1000) }),
  z.object({ op: z.literal("test"), lang: z.string().max(5).optional() }),
  // Lumper money: a driver at the dock asks (the office's phones buzz), and the office sent the code (the driver's does).
  z.object({ op: z.literal("lumper_ask"), amount: z.number().positive().max(5000), facility: z.string().max(80).optional() }),
  z.object({ op: z.literal("lumper_code"), driverId: z.string().min(1).max(80) }),
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
  if (b.op === "lumper_ask") {
    if (who.me.role !== "driver" || !who.me.driverId) return Response.json({ error: "drivers_only" }, { status: 403 });
    const { data: d } = await db.from("drivers").select("name").eq("carrier_id", who.me.carrierId).eq("id", who.me.driverId).maybeSingle();
    const sent = await pushToOffice(who.me.carrierId, {
      title: `Lumper money: $${Math.round(b.amount)}`,
      body: `${(d?.name as string | undefined) ?? "A driver"} is at the dock${b.facility ? ` (${b.facility})` : ""} and needs a code to pay the lumper.`,
      url: "/carrier",
      tag: `lumper-${who.me.driverId}`,
    });
    return Response.json({ ok: true, sent });
  }
  if (b.op === "lumper_code") {
    if (who.me.role !== "owner" && who.me.role !== "dispatcher") return Response.json({ error: "office_only" }, { status: 403 });
    // The code itself stays in the app, not on the lock screen.
    const sent = await pushToDriver(who.me.carrierId, b.driverId, { title: "Lumper code is ready", body: "Open the app to see the code to give the lumper service.", url: "/driver", tag: "lumper-code" });
    return Response.json({ ok: true, sent });
  }
  const sent =
    who.me.role === "driver"
      ? who.me.driverId
        ? await pushToDriver(who.me.carrierId, who.me.driverId, { title: "Dispatch", body: TEST_DRIVER[lang(b)] ?? TEST_DRIVER.en, url: "/driver", tag: "test" })
        : 0
      : await pushToOffice(who.me.carrierId, { title: "Backroute", body: "Phone alerts are on. You'll hear from us when something needs you.", url: "/carrier", tag: "test" });
  return Response.json({ ok: true, sent });
}
