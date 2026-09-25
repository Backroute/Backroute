"use client";

import { useState } from "react";
import { Loader2, Mail, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";
import { useStore } from "@/lib/store";
import type { Escalation } from "@/lib/types";

/**
 * A reply the AI wrote for a broker, waiting for the owner. They can fix the wording, then send it or not. Nothing
 * goes out from here without that tap (unless autopilot is on full, and then it never lands here).
 */
export function DraftApproval({ escalation }: { escalation: Escalation }) {
  const draft = escalation.draft!;
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState<"send" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(send: boolean) {
    setBusy(send ? "send" : "skip");
    setError(null);
    try {
      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ escalationId: escalation.id, send, body: body.trim() === draft.body.trim() ? undefined : body }),
      });
      const data = (await res.json().catch(() => null)) as { escalation?: Escalation; error?: string } | null;
      if (!res.ok || !data?.escalation) {
        setError(data?.error === "email_off" ? "Email isn't switched on yet, so it can't be sent." : "Couldn't do that. Check your connection and try again.");
        return;
      }
      const updated = data.escalation;
      useStore.setState((s) => ({ escalations: s.escalations.map((e) => (e.id === updated.id ? updated : e)) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
        <Mail className="h-3.5 w-3.5" /> To {draft.toName ? `${draft.toName} <${draft.to}>` : draft.to} · {draft.subject}
      </p>
      <label className="sr-only" htmlFor={`draft-${escalation.id}`}>
        Reply
      </label>
      <textarea
        id={`draft-${escalation.id}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(10, Math.max(4, body.split("\n").length + 1))}
        className="mt-2 w-full resize-y rounded-lg border border-line bg-ink-50/50 px-3 py-2 text-sm leading-relaxed text-ink-900 outline-none focus:border-ink-400"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={!!busy || !body.trim()} onClick={() => answer(true)}>
          {busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => answer(false)}>
          <X className="h-3.5 w-3.5" /> Don&apos;t send
        </Button>
        {error && <span className="text-xs text-[var(--accent-danger)]">{error}</span>}
      </div>
    </div>
  );
}

const SOURCE_LABEL = { sms: "By text", voice: "On a call", email: "By email", app: "In the app" } as const;

export function SourceTag({ source }: { source: Escalation["source"] }) {
  if (!source || source === "app") return null;
  return <span className="mb-1.5 inline-block rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-500">{SOURCE_LABEL[source]}</span>;
}
