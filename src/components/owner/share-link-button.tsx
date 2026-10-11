"use client";

import { useState } from "react";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { authHeader } from "@/lib/ai/client";
import { useStore } from "@/lib/store";

/**
 * Makes a no-sign-in link (a load's tracking page, or a direct shipper's page of their loads), copies it, and offers to
 * email it. The sample account's link opens the sample in this browser.
 */
export function ShareLinkButton({ kind, id, label, email, subject }: { kind: "track" | "shipper"; id: string; label: string; email?: string; subject?: string }) {
  const demo = useStore((s) => s.session.mode === "demo");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function make() {
    setErr(null);
    if (demo) return show(`${window.location.origin}/${kind}/demo-${id}`);
    setBusy(true);
    const res = await fetch(`/api/${kind}`, { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(kind === "track" ? { loadId: id } : { brokerId: id }) }).catch(() => null);
    setBusy(false);
    const body = res?.ok ? ((await res.json()) as { url?: string }) : null;
    if (body?.url) show(body.url);
    else setErr("Couldn't make the link. Try again.");
  }
  function show(u: string) {
    setUrl(u);
    void navigator.clipboard?.writeText(u).then(() => setCopied(true), () => setCopied(false));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => void make()} disabled={busy} className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} {label}
      </button>
      {url && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input readOnly value={url} aria-label="Link" onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-full border border-line bg-ink-50 px-3 py-1.5 text-ink-700" />
          <button type="button" onClick={() => show(url)} className="inline-flex items-center gap-1 font-medium text-ink-700">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
          {email && (
            <a className="font-medium text-[var(--link)] underline" href={`mailto:${email}?subject=${encodeURIComponent(subject ?? "Tracking")}&body=${encodeURIComponent(`Here's the link to follow it, no sign-in needed:\n${url}`)}`}>
              Email it
            </a>
          )}
        </div>
      )}
      {err && <p className="text-xs text-[var(--accent-danger)]">{err}</p>}
    </div>
  );
}
