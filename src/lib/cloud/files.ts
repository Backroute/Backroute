import { authHeader } from "../ai/client";

export type FileKind = "w9" | "coi" | "authority" | "noa" | "bol" | "pod" | "lumper_receipt" | "other";

export type Uploaded = { ok: true; id: string; status: "verified" | "check"; note: string | null } | { ok: false; reason: string };

const REASON: Record<string, string> = {
  too_large: "That file is over 10 MB.",
  type: "Use a photo or a PDF.",
  sign_in: "Sign in again, then retake it.",
  office_only: "Only the office can add that.",
  not_found: "That load isn't on your truck.",
};

/** Sends a file to the server (api/files), which stores it and, for a BOL or POD, has the AI check it. */
export async function uploadFile(kind: FileKind, file: File, extra: { loadId?: string; expiresOn?: string } = {}): Promise<Uploaded> {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);
  if (extra.loadId) form.set("loadId", extra.loadId);
  if (extra.expiresOn) form.set("expiresOn", extra.expiresOn);
  try {
    const res = await fetch("/api/files", { method: "POST", headers: await authHeader(), body: form, signal: AbortSignal.timeout(90_000) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; status?: "verified" | "check"; note?: string | null; error?: string };
    if (!res.ok || !body.id) return { ok: false, reason: REASON[body.error ?? ""] ?? "Didn't upload. Check the signal." };
    return { ok: true, id: body.id, status: body.status ?? "verified", note: body.note ?? null };
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
