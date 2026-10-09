import { z } from "zod";
import { dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { deleteCarrier, EXPORT_TABLES, exportCarrier, exportPage } from "@/lib/account";

/**
 * The owner's own data: GET is the download (no ?table: the carrier and the list of tables; ?table=&page=: one page of
 * it), DELETE deletes the account. Owner only: dispatchers and bookkeepers see a lot, but not everything, and can't
 * close the company's account.
 */

async function owner(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  if (who.me.role !== "owner") return Response.json({ error: "owner_only" }, { status: 403 });
  return who;
}

export async function GET(request: Request) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  if (!table) {
    const { carrier, billing } = await exportCarrier(who.me.carrierId);
    if (!carrier) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ carrier, billing, tables: Object.keys(EXPORT_TABLES) });
  }
  if (!(table in EXPORT_TABLES)) return Response.json({ error: "bad_request" }, { status: 400 });
  const page = Math.max(0, Math.min(10_000, Number(url.searchParams.get("page")) || 0));
  return Response.json(await exportPage(who.me.carrierId, table, page));
}

const Body = z.object({ confirm: z.string().min(1).max(200) });

export async function DELETE(request: Request) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { carrier } = await exportCarrier(who.me.carrierId);
  if (!carrier) return Response.json({ error: "not_found" }, { status: 404 });
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (norm(parsed.data.confirm) !== norm(String(carrier.name))) return Response.json({ error: "confirm" }, { status: 400 });
  const done = await deleteCarrier(who.me.carrierId, `owner ${who.me.userId}`);
  if (!done.ok) return Response.json({ error: done.reason }, { status: done.reason === "billing" ? 502 : 404 });
  console.log("[account] deleted", who.me.carrierId, "by the owner;", done.removedUsers, "sign-ins removed");
  return Response.json({ deleted: true });
}
