import { authHeader } from "../ai/client";
import { enqueue, startQueue, whenSent, type Queued } from "./upload-queue";

export type FileKind = "w9" | "coi" | "authority" | "noa" | "voided_check" | "bol" | "pod" | "lumper_receipt" | "receipt" | "dvir_photo" | "other";

type Uploaded = { ok: true; id: string; status: "verified" | "check"; note: string | null; amount?: number | null } | { ok: false; reason: string; queued?: boolean };

const REASON: Record<string, string> = {
  too_large: "That file is over 10 MB.",
  type: "Use a photo or a PDF.",
  sign_in: "Sign in again, then retake it.",
  office_only: "Only the office can add that.",
  not_found: "That load isn't on your truck.",
};

async function send(kind: string, file: Blob, name: string, extra: { loadId?: string; expiresOn?: string }): Promise<Uploaded & { network?: boolean }> {
  const form = new FormData();
  form.set("file", file, name);
  form.set("kind", kind);
  if (extra.loadId) form.set("loadId", extra.loadId);
  if (extra.expiresOn) form.set("expiresOn", extra.expiresOn);
  try {
    const res = await fetch("/api/files", { method: "POST", headers: await authHeader(), body: form, signal: AbortSignal.timeout(90_000) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; status?: "verified" | "check"; note?: string | null; amount?: number | null; error?: string };
    if (!res.ok || !body.id) return { ok: false, reason: REASON[body.error ?? ""] ?? "Didn't upload. Check the signal.", network: res.status >= 500 };
    return { ok: true, id: body.id, status: body.status ?? "verified", note: body.note ?? null, amount: body.amount ?? null };
  } catch {
    return { ok: false, reason: "Didn't upload. Check the signal.", network: true };
  }
}

// Photos kept on the phone go the same way once there's signal.
const sendQueued = async (q: Queued) => (await send(q.kind, q.blob, q.name, { loadId: q.loadId })).ok;

/**
 * Sends a file to the server (api/files), which stores it and, for a BOL or POD, has the AI check it. A load's photo
 * that can't go for lack of signal is kept on the phone and sent when it's back: `onQueued` is told, and the result
 * comes when it finally goes.
 */
export async function uploadFile(kind: FileKind, file: File, extra: { loadId?: string; expiresOn?: string; onQueued?: () => void } = {}): Promise<Uploaded> {
  startQueue(sendQueued);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const first = offline ? ({ ok: false, reason: "", network: true } as const) : await send(kind, file, file.name, extra);
  if (first.ok || !first.network || !extra.loadId) return first;
  try {
    const id = await enqueue({ kind, loadId: extra.loadId, name: file.name, type: file.type, blob: file });
    extra.onQueued?.();
    await whenSent(id);
    // Sent: what the server said about it comes with the load's next refresh; this says it's in.
    return { ok: true, id, status: "verified", note: "Sent once you had signal." };
  } catch {
    return { ok: false, reason: "Didn't upload. Check the signal." };
  }
}

/** Opens a stored file in a new tab (the request carries the sign-in, so a plain link wouldn't work). */
export async function openFile(id: string) {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`/api/files/${id}`, { headers: await authHeader() });
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch {
    tab?.close();
    alert("Couldn't open that file.");
  }
}
