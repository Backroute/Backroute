import { z } from "zod";
import { dbConfigured, save } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import type { Item } from "@/lib/cloud/rows";
import { PRIMARY_CARRIER_ID } from "@/lib/mock-data";
import { overLimit, tooMany } from "@/lib/rate-limit";
import type { Escalation } from "@/lib/types";

/**
 * "Connect it for me": for a service without a public API Backroute can sign into on its own (123Loadboard, a
 * factoring company's portal, a tracking app's carrier account), the owner asks and Backroute's support team sets it
 * up with them. It goes in as a support item the owner can see, so nothing is promised that isn't being done.
 */
const Body = z.object({ name: z.string().trim().min(2).max(60), note: z.string().trim().max(500).optional() });

export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return Response.json({ error: "sign_in" }, { status: 401 });
  if (await overLimit(`int-request:${who.me.carrierId}`, 86400, 10)) return tooMany();
  const b = Body.safeParse(await request.json().catch(() => null));
  if (!b.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const escalation: Escalation = {
    id: `esc-int-${Date.now().toString(36)}`,
    loadId: "",
    carrierId: PRIMARY_CARRIER_ID,
    reason: `Connect ${b.data.name} for this carrier${b.data.note ? `: ${b.data.note}` : ""}. Reach the owner to finish the setup.`,
    createdAt: new Date().toISOString(),
    status: "with_support",
    complexity: "routine",
    recommendedAction: "approve",
    recommendedLabel: "Got it",
    source: "app",
  };
  await save("escalations", who.me.carrierId, escalation as unknown as Item);
  return Response.json({ ok: true });
}
