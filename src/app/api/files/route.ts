import { z } from "zod";
import { aiConfigured } from "@/lib/ai/server";
import { checkStopDocument } from "@/lib/ai/doc-check";
import { admin, dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";

const Kind = z.enum(["w9", "coi", "authority", "noa", "voided_check", "bol", "pod", "lumper_receipt", "receipt", "dvir_photo", "cab_card", "insurance_card", "ifta_license", "annual_inspection", "other"]);
/** The papers a driver shows at a roadside inspection, for one truck or the whole fleet (lib/cloud/files TRUCK_PAPERS). */
const TRUCK_PAPERS = ["cab_card", "insurance_card", "ifta_license", "annual_inspection"];
const OFFICE_PAPERS = ["w9", "coi", "authority", "noa", "voided_check", ...TRUCK_PAPERS];
const STOP_DOCS = new Set(["bol", "pod", "lumper_receipt"]);
/** What a driver photographs on the road that isn't tied to a stop: a receipt for an expense, an inspection defect. */
const ROAD_PHOTOS = new Set(["receipt", "dvir_photo"]);
const MAX = 10 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"]);

export const maxDuration = 60;

/**
 * Upload a file: a driver's BOL or POD photo for a load on their truck, or the carrier's own paperwork (W-9,
 * insurance certificate, authority, notice of assignment, voided check), which only the office can add. The AI checks stop
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
  const truckId = form?.get("truckId") ? String(form.get("truckId")) : null;
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
  } else if (ROAD_PHOTOS.has(kind.data)) {
    if (loadId) {
      const { data } = await who.db.from("loads").select("id").eq("id", loadId).eq("carrier_id", who.me.carrierId).maybeSingle();
      if (!data) return Response.json({ error: "not_found" }, { status: 404 });
    }
  } else if (!office) return Response.json({ error: "office_only" }, { status: 403 });
  if (truckId) {
    if (!TRUCK_PAPERS.includes(kind.data)) return Response.json({ error: "bad_request" }, { status: 400 });
    const { data } = await who.db.from("trucks").select("id").eq("id", truckId).eq("carrier_id", who.me.carrierId).maybeSingle();
    if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let note: string | null = null;
  let status: "verified" | "check" = "verified";
  let amount: number | null = null;
  // A receipt: what was paid, so the driver doesn't type it.
  if (kind.data === "receipt" && aiConfigured()) {
    const check = await checkStopDocument("receipt", bytes, file.type, loadRef).catch(() => null);
    if (check?.amount && check.amount > 0 && check.amount < 5000) amount = Math.round(check.amount * 100) / 100;
    if (check) note = check.note;
  }
  if (STOP_DOCS.has(kind.data) && aiConfigured()) {
    const check = await checkStopDocument(kind.data as "bol" | "pod" | "lumper_receipt", bytes, file.type, loadRef).catch(() => null);
    if (check) {
      note = check.exceptions.length ? `${check.note} Noted on it: ${check.exceptions.join("; ")}.` : check.note;
      if (kind.data === "lumper_receipt" && check.amount && check.amount > 0 && check.amount < 5000) amount = Math.round(check.amount * 100) / 100;
      if (!check.isExpectedDocument || (kind.data !== "lumper_receipt" && !check.signed) || check.exceptions.length) status = "check";
      // Too blurry for a broker's billing clerk: the app shows the tip so the driver retakes it at the dock.
      if (check.readable === "unreadable") {
        status = "check";
        note = `Hard to read: please retake it. ${check.retakeTip ?? "Lay it flat, turn on the flash, and get all four corners in."}`;
      }
    }
  }
  const { data: row, error } = await admin()
    .from("carrier_files")
    .insert({ carrier_id: who.me.carrierId, kind: kind.data, load_id: loadId, name: file.name, content_type: file.type, size: file.size, data: bytes.toString("base64"), expires_on: expiresOn, note, uploaded_by: who.me.userId, truck_id: truckId })
    .select("id")
    .single();
  if (error) return Response.json({ error: "save_failed" }, { status: 500 });
  return Response.json({ id: row.id, status, note, amount });
}

/**
 * The carrier's own paperwork on file (not the file contents). The office sees all of it; a driver sees only the
 * papers for their own truck (the access rules decide), to show at a roadside inspection.
 */
export async function GET(request: Request) {
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  const { data } = await who.db
    .from("carrier_files")
    .select("id, kind, name, size, expires_on, created_at, truck_id")
    .eq("carrier_id", who.me.carrierId)
    .in("kind", who.me.role === "driver" ? TRUCK_PAPERS : OFFICE_PAPERS)
    .order("created_at", { ascending: false });
  return Response.json({ files: data ?? [] });
}
