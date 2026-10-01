import { z } from "zod";
import { admin, dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { consentsFor, DRIVER_AGREES, OWNER_ATTESTS, recordConsent, releaseHeld } from "@/lib/consent";
import { clientIp } from "@/lib/rate-limit";
import { LANGS } from "@/lib/lang";
import type { Driver, Lang } from "@/lib/types";

const Body = z.discriminatedUnion("op", [
  // The driver, in the app: yes or no to texts and calls from dispatch, in the language the words were shown in.
  z.object({ op: z.literal("agree"), granted: z.boolean(), lang: z.string().max(5).optional() }),
  // The owner (or a dispatcher): these drivers agreed when they were hired. By driver id, or by the phone numbers
  // just typed in (the new drivers may still be on their way to the database).
  z.object({ op: z.literal("attest"), driverIds: z.array(z.string().max(100)).max(100).optional(), phones: z.array(z.string().max(30)).max(100).optional() }),
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Consent to texts and calls: each driver's latest answer (office), or the driver's own; and recording a new one. */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  const all = await consentsFor(who.me.carrierId);
  if (who.me.role === "driver") return Response.json({ mine: who.me.driverId ? (all.get(who.me.driverId) ?? null) : null });
  return Response.json({ drivers: Object.fromEntries(all) });
}

export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  const { data: carrier } = await admin().from("carriers").select("name").eq("id", who.me.carrierId).maybeSingle();
  const name = (carrier?.name as string) ?? "your carrier";
  const seen = { ip: clientIp(request), userAgent: request.headers.get("user-agent") };

  if (b.op === "agree") {
    if (!who.me.driverId) return Response.json({ error: "not_a_driver" }, { status: 403 });
    const { data: row } = await admin().from("drivers").select("phone").eq("carrier_id", who.me.carrierId).eq("id", who.me.driverId).maybeSingle();
    const lang: Lang = LANGS.some((l) => l.code === b.lang) ? (b.lang as Lang) : "en";
    await recordConsent({ carrierId: who.me.carrierId, driverId: who.me.driverId, phone: (row?.phone as string) ?? null, granted: b.granted, via: "app", wording: b.granted ? DRIVER_AGREES[lang](name) : `Declined: ${DRIVER_AGREES[lang](name)}`, byUser: who.me.userId, ...seen });
    if (b.granted) await releaseHeld(who.me.carrierId, row?.phone as string | null).catch((e) => console.error("[consent] couldn't send held texts", e));
    return Response.json({ ok: true });
  }

  if (who.me.role === "driver") return Response.json({ error: "owner_only" }, { status: 403 });
  const ids = new Set(b.driverIds ?? []);
  const last10s = (b.phones ?? []).map((p) => p.replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10);
  // Drivers typed in a moment ago reach the database a moment later: wait for them briefly.
  let found: Driver[] = [];
  for (let i = 0; i < 6; i++) {
    const [byId, byPhone] = await Promise.all([
      ids.size ? admin().from("drivers").select("data").eq("carrier_id", who.me.carrierId).in("id", [...ids]) : Promise.resolve({ data: [] }),
      last10s.length ? admin().from("drivers").select("data").eq("carrier_id", who.me.carrierId).in("phone_last10", last10s) : Promise.resolve({ data: [] }),
    ]);
    found = [...(byId.data ?? []), ...(byPhone.data ?? [])].map((r) => r.data as Driver).filter((d, n, all) => all.findIndex((x) => x.id === d.id) === n);
    if (found.length >= ids.size + last10s.length) break;
    await sleep(1500);
  }
  for (const d of found) {
    await recordConsent({ carrierId: who.me.carrierId, driverId: d.id, phone: d.phone, granted: true, via: "owner", wording: OWNER_ATTESTS(name), byUser: who.me.userId, ...seen });
    await releaseHeld(who.me.carrierId, d.phone).catch((e) => console.error("[consent] couldn't send held texts", e));
  }
  return Response.json({ ok: true, recorded: found.length });
}
