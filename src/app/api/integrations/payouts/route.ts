import { z } from "zod";
import { dbConfigured } from "@/lib/agent/db";
import { payoutsFor, removeDriverBank, saveCompany, saveDriverBank, weekFile } from "@/lib/agent/payouts";
import { caller } from "@/lib/agent/user";
import { vaultConfigured } from "@/lib/portal/vault";
import { overLimit, tooMany } from "@/lib/rate-limit";

/**
 * Direct deposit, owner only: GET what's set up (never the account numbers, just the last four), POST the sending bank
 * or a driver's account, DELETE a driver's account, and GET ?file=<monday> for that week's NACHA file.
 */
async function owner(request: Request) {
  if (!dbConfigured() || !vaultConfigured()) return { error: Response.json({ error: "not_set_up" }, { status: 503 }) };
  const who = await caller(request);
  if (!who || who.me.role !== "owner") return { error: Response.json({ error: "sign_in" }, { status: 401 }) };
  return { who };
}

export async function GET(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  const url = new URL(request.url);
  const period = url.searchParams.get("file");
  if (period) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return Response.json({ error: "bad_request" }, { status: 400 });
    if (await overLimit(`nacha:${o.who.me.carrierId}`, 3600, 20)) return tooMany();
    const eff = url.searchParams.get("effective");
    const effective = eff && /^\d{4}-\d{2}-\d{2}$/.test(eff) ? new Date(`${eff}T12:00:00Z`) : new Date(Date.now() + 86400_000);
    try {
      return Response.json(await weekFile(o.who.me.carrierId, period, effective));
    } catch (e) {
      return Response.json({ error: "no_file", reason: e instanceof Error ? e.message : "error" }, { status: 422 });
    }
  }
  const c = await payoutsFor(o.who.me.carrierId);
  return Response.json({
    company: c.company ?? null,
    drivers: Object.fromEntries(Object.entries(c.drivers).map(([id, d]) => [id, { routing: d.routing, last4: d.last4, type: d.type, at: d.at }])),
  });
}

const Body = z.union([
  z.object({
    company: z.object({
      name: z.string().trim().min(2).max(60),
      companyId: z.string().trim().min(5).max(10),
      bankRouting: z.string().regex(/^\d{9}$/),
      bankName: z.string().trim().min(2).max(60),
      immediateOrigin: z.string().trim().max(10).optional(),
    }),
  }),
  z.object({ driverId: z.string().min(1).max(80), routing: z.string().regex(/^\d{9}$/), account: z.string().trim().min(4).max(20), type: z.enum(["checking", "savings"]) }),
]);

export async function POST(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", reason: "Check the numbers." }, { status: 400 });
  const b = parsed.data;
  const problem = "company" in b ? await saveCompany(o.who.me.carrierId, b.company) : await saveDriverBank(o.who.me.carrierId, b.driverId, b);
  return problem ? Response.json({ error: "invalid", reason: problem }, { status: 422 }) : Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const o = await owner(request);
  if ("error" in o) return o.error;
  const driverId = new URL(request.url).searchParams.get("driverId");
  if (!driverId) return Response.json({ error: "bad_request" }, { status: 400 });
  await removeDriverBank(o.who.me.carrierId, driverId);
  return Response.json({ ok: true });
}
