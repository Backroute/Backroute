import { z } from "zod";
import { aiConfigured } from "@/lib/ai/server";
import { checkStopDocument } from "@/lib/ai/doc-check";
import { admin, dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";

const Kind = z.enum(["w9", "coi", "authority", "noa", "bol", "pod", "lumper_receipt", "other"]);
const STOP_DOCS = new Set(["bol", "pod", "lumper_receipt"]);
const MAX = 10 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"]);

export const maxDuration = 60;

/**
 * Upload a file: a driver's BOL or POD photo for a load on their truck, or the carrier's own paperwork (W-9,
 * insurance certificate, authority, notice of assignment), which only the office can add. The AI checks stop
 * documents the way a dispatcher would before billing.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = Kind.safeParse(form?.get("kind"));
  const loadId = form?.get("loadId") ? String(form.get("loadId")) : null;
  const expiresOn = form?.get("expiresOn") ? String(form.get("expiresOn")) : null;
  if (!(file instanceof File) || !kind.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "too_large" }, { status: 413 });
  if (!TYPES.has(file.type)) return Response.json({ error: "type" }, { status: 415 });

  const office = who.me.role !== "driver";
  let loadRef = "";
  if (STOP_DOCS.has(kind.data)) {
    if (!loadId) return Response.json({ error: "bad_request" }, { status: 400 });
    // Read as the person uploading: they only see loads their role allows (a driver, their own truck's).
    const { data } = await who.db.from("loads").select("id, data").eq("id", loadId).eq("carrier_id", who.me.carrierId).maybeSingle();
    if (!data) return Response.json({ error: "not_found" }, { status: 404 });
    loadRef = (data.data as { referenceNumber?: string }).referenceNumber ?? "";
  } else if (!office) return Response.json({ error: "office_only" }, { status: 403 });

  const bytes = Buffer.from(await file.arrayBuffer());
  let note: string | null = null;
  let status: "verified" | "check" = "verified";
  if (STOP_DOCS.has(kind.data) && aiConfigured()) {
    const check = await checkStopDocument(kind.data as "bol" | "pod" | "lumper_receipt", bytes, file.type, loadRef).catch(() => null);
    if (check) {
      note = check.exceptions.length ? `${check.note} Noted on it: ${check.exceptions.join("; ")}.` : check.note;
      if (!check.isExpectedDocument || (kind.data !== "lumper_receipt" && !check.signed) || check.exceptions.length) status = "check";
    }
  }
  const { data: row, error } = await admin()
    .from("carrier_files")
    .insert({ carrier_id: who.me.carrierId, kind: kind.data, load_id: loadId, name: file.name, content_type: file.type, size: file.size, data: bytes.toString("base64"), expires_on: expiresOn, note, uploaded_by: who.me.userId })
    .select("id")
    .single();
  if (error) return Response.json({ error: "save_failed" }, { status: 500 });
  return Response.json({ id: row.id, status, note });
}

/** The carrier's own paperwork on file (not the file contents). Office only. */
export async function GET(request: Request) {
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const { data } = await who.db
    .from("carrier_files")
    .select("id, kind, name, size, expires_on, created_at")
    .eq("carrier_id", who.me.carrierId)
    .in("kind", ["w9", "coi", "authority", "noa"])
    .order("created_at", { ascending: false });
  return Response.json({ files: data ?? [] });
}
