"use client";

import { useEffect, useState } from "react";
import { Check, Globe, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";
import { applyFromServer } from "@/lib/cloud/sync";
import { portalAct, portalTask } from "@/lib/cloud/portal";
import type { Item } from "@/lib/cloud/rows";
import type { PortalTaskView } from "@/lib/portal/types";
import type { Escalation } from "@/lib/types";

/**
 * The AI's work on a broker's website, waiting on the owner: the page it's on, and either Submit / Stop, or the
 * question the website asked (a login, a tax ID, a code). Answers are kept, encrypted, so it isn't asked again.
 */
export function PortalApproval({ escalation }: { escalation: Escalation }) {
  const [task, setTask] = useState<PortalTaskView | null>(null);
  const [key, setKey] = useState<string | undefined>();
  const [shot, setShot] = useState<string | null>(null);
  const [answer, setAnswer] = useState({ text: "", username: "", password: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    void (async () => {
      const r = await portalTask(escalation.portalTaskId!);
      if (!live || !r.ok) return;
      setTask(r.data.task);
      setKey(r.data.question);
      if (r.data.task.screenshotId) {
        const res = await fetch(`/api/files/${r.data.task.screenshotId}`, { headers: await authHeader() }).catch(() => null);
        if (live && res?.ok) setShot((url = URL.createObjectURL(await res.blob())));
      }
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [escalation.portalTaskId]);

  function resolved(note: string) {
    applyFromServer("escalations", [{ ...escalation, status: "resolved", resolvedBy: "carrier", resolvedAt: new Date().toISOString(), resolutionNote: note } as unknown as Item]);
  }

  async function act(op: string, body: Record<string, unknown> = {}) {
    setBusy(op);
    setError(null);
    const r = await portalAct({ op, taskId: escalation.portalTaskId, ...body });
    setBusy(null);
    if (!r.ok) return setError(r.reason);
    resolved(op === "stop" ? "Stopped" : op === "approve" ? "Submitted" : "Answered");
  }

  if (!task) return <p className="mt-2 text-xs text-ink-500">…</p>;
  const waiting = task.status === "needs_approval" || task.status === "needs_answer";
  const login = key?.startsWith("login:");
  const input = "min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
        <Globe className="h-3.5 w-3.5" /> {task.site}
        {task.loadRef ? ` · ${task.loadRef}` : ""}
      </p>
      {shot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot} alt={`What the AI sees on ${task.site}`} className="max-h-72 w-full rounded-lg border border-line object-contain object-top" />
      )}
      {!waiting ? (
        <p className="text-xs text-ink-500">Already taken care of.</p>
      ) : task.status === "needs_approval" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void act("approve")}>
            {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Submit it
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act("stop")}>
            <X className="h-3.5 w-3.5" /> Don&apos;t
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void act("answer", login ? { username: answer.username, password: answer.password } : { answer: key?.startsWith("paper_") ? "done" : answer.text });
          }}
        >
          {login ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={input} placeholder="User name or email" aria-label="User name" value={answer.username} onChange={(e) => setAnswer({ ...answer, username: e.target.value })} />
              <input className={input} type="password" autoComplete="new-password" placeholder="Password" aria-label="Password" value={answer.password} onChange={(e) => setAnswer({ ...answer, password: e.target.value })} />
            </div>
          ) : key?.startsWith("paper_") ? null : (
            <input
              className={input}
              type={task.secretAnswer ? "password" : "text"}
              autoComplete="off"
              aria-label="Your answer"
              placeholder="Your answer"
              value={answer.text}
              onChange={(e) => setAnswer({ ...answer, text: e.target.value })}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={!!busy || (login ? !answer.username.trim() || !answer.password : !key?.startsWith("paper_") && !answer.text.trim())}>
              {busy === "answer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {key?.startsWith("paper_") ? "It's uploaded" : "Send"}
            </Button>
            <Button size="sm" variant="outline" type="button" disabled={!!busy} onClick={() => void act("stop")}>
              <X className="h-3.5 w-3.5" /> Stop
            </Button>
          </div>
          {task.secretAnswer && <p className="text-[11px] text-ink-500">Encrypted, and used only on these websites. Support can&apos;t see it.</p>}
        </form>
      )}
      {error && <span className="text-xs text-[var(--accent-danger)]">{error}</span>}
    </div>
  );
}
