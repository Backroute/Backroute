"use client";

import { useEffect, useState } from "react";
import { Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";
import { useStore } from "@/lib/store";

interface Held {
  id: string;
  loadId: string | null;
  summary: string;
  sendAt: string;
}

async function list(): Promise<Held[]> {
  const res = await fetch("/api/agent/undo", { headers: await authHeader() });
  if (!res.ok) throw new Error("load");
  return ((await res.json()) as { held: Held[] }).held;
}

/**
 * What the AI is about to email a broker on its own (a book request, a counter, an acceptance), each with Undo while
 * it waits (lib/agent/held). Gone from the page once it's sent.
 */
export function GoingOutCard() {
  const real = useStore((s) => s.session.mode !== "demo");
  const [held, setHeld] = useState<Held[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!real) return;
    let live = true;
    const load = () =>
      list()
        .then((h) => live && setHeld(h))
        .catch(() => {});
    load();
    const poll = setInterval(load, 8000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [real]);

  async function undo(h: Held) {
    setBusy(h.id);
    const res = await fetch("/api/agent/undo", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ id: h.id }) }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { note?: string; error?: string }) : { error: "offline" };
    setNote(res?.ok ? (body.note ?? "Stopped.") : body.error === "already_sent" ? "Too late: it already went." : "Couldn't stop it. Try again.");
    setHeld((list) => list.filter((x) => x.id !== h.id));
    setBusy(null);
  }

  const waiting = held.filter((h) => Date.parse(h.sendAt) > now - 5000);
  if (!real || (!waiting.length && !note)) return null;
  return (
    <section aria-label="About to send" className="rounded-2xl border border-line bg-white p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
        <Send className="h-3.5 w-3.5" /> About to send
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {waiting.map((h) => {
          const left = Math.max(0, Math.ceil((Date.parse(h.sendAt) - now) / 1000));
          return (
            <li key={h.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
              <span className="min-w-0 text-sm text-ink-900">
                {h.summary}
                <span className="ml-2 text-xs tabular text-ink-500">{left > 0 ? `goes in ${left}s` : "sending…"}</span>
              </span>
              <Button size="sm" variant="outline" className="min-h-11 sm:min-h-0" disabled={busy === h.id || left === 0} onClick={() => void undo(h)}>
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </Button>
            </li>
          );
        })}
      </ul>
      {note && <p className="mt-2 text-sm text-ink-700" role="status">{note}</p>}
    </section>
  );
}
