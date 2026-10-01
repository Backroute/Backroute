import { dbConfigured, loadContext } from "@/lib/agent/db";
import { historyHash, importRateCons, openHistoryInbox, type DocFile } from "@/lib/agent/history-docs";
import { validBatchId } from "@/lib/agent/import-batches";
import { caller } from "@/lib/agent/user";
import { inboundAddress } from "@/lib/channels/email";

export const maxDuration = 300;

const OK_TYPES = /^(application\/pdf|image\/(jpeg|png|webp))$/;

/**
 * Old rate cons into the history (lib/agent/history-docs): a batch of PDFs or photos uploaded here, or, with
 * ?inbox=open, the history address opened for a week so the owner can forward them from their email instead.
 * The app sends a big pick in parts (a request body has a size limit), each with the same `batch`, so they're one
 * import to undo. The owner or a dispatcher only.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const ctx = await loadContext(who.me.carrierId);
  if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });

  if (new URL(request.url).searchParams.get("inbox") === "open") {
    const { until, token } = await openHistoryInbox(ctx.carrier.id);
    const address = inboundAddress(historyHash(ctx.carrier.inbound_key, token));
    return Response.json({ until, address });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "bad_request" }, { status: 400 });
  const files: DocFile[] = [];
  for (const v of form.getAll("files")) {
    if (typeof v === "string" || !OK_TYPES.test(v.type) || v.size > 10 * 1024 * 1024) continue;
    files.push({ name: v.name, bytes: Buffer.from(await v.arrayBuffer()), contentType: v.type });
  }
  if (!files.length) return Response.json({ error: "no_files" }, { status: 400 });
  const batch = form.get("batch");
  try {
    return Response.json(await importRateCons(ctx, files, { batch: validBatchId(batch) ? batch : undefined }));
  } catch (e) {
    console.error("[import] rate cons failed", e);
    return Response.json({ error: "import_failed" }, { status: 500 });
  }
}
