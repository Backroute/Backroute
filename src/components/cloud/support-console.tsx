"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Hand, Loader2, LogOut, Mail, MessageSquare, Phone, Send, Undo2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { TimeAgo } from "@/components/shared/time-ago";
import { authHeader } from "@/lib/ai/client";
import { formatPhone } from "@/lib/cloud/phone";
import { signOut } from "@/lib/cloud/sync";
import { handoffKind, PLAYBOOK, SLA_MINUTES } from "@/lib/support-playbooks";
import type { Escalation } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { StatusMark } from "@/components/ui/mark";

interface QueueItem {
  carrier: { id: string; name: string; mc: string | null; ownerPhone: string | null; autonomy: string };
  escalation: Escalation;
  load: { id: string; ref: string; lane: string; stage: string; pickup: string; delivery: string; rate: number } | null;
  truck: { unit: string } | null;
  driver: { id: string; name: string; phone: string; language: string; smsOptOut: boolean } | null;
  broker: { id: string; company: string; email: string; phone: string; mc: string | null; verified: boolean; note: string | null } | null;
  thread: { channel: string; direction: string; counterparty: string | null; body: string | null; created_at: string; data: { subject?: string; bySupport?: string } }[];
  /** A broker website the AI couldn't finish: the link, its steps (never the values it typed) and what it last saw. */
  portal?: { url: string; kind: string; note: string | null; steps: string[]; screenshot: string | null } | null;
}
interface CarrierRow {
  id: string;
  name: string;
  mc: string | null;
  ownerPhone: string | null;
  autonomy: string;
  waiting: number;
}
interface Queue {
  me: { name: string };
  items: QueueItem[];
  carriers: CarrierRow[];
}

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "").replace(/^(\d{10})$/, "+1$1").replace(/^1(\d{10})$/, "+1$1")}`;
const AUTONOMY: Record<string, string> = { ask: "Ask me first", rules: "Within my rules", full: "Full autopilot" };

async function act(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/support/act", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { opted_out: "This driver texted STOP: call them instead.", sms_off: "Texting isn't switched on.", email_off: "Email isn't switched on.", no_owner_phone: "No owner phone on file." }[data.error ?? ""] ?? "Didn't work. Try again.";
  } catch {
    return "Offline. Try again.";
  }
}

/**
 * Backroute's support console: everything the AI handed off, across every carrier, with who to call and what was
 * said, and the few actions a person takes. The AI keeps working on everything else.
 */
export function SupportConsole() {
  const [q, setQ] = useState<Queue | null>(null);
  const [tab, setTab] = useState<"queue" | "carriers" | "numbers" | "system">("queue");
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/support/queue", { headers: await authHeader() });
      if (res.ok) setQ((await res.json()) as Queue);
    } catch {
      // Offline: keeps what it has and tries again on the next tick.
    }
  }, []);
  useEffect(() => {
    // Loading the queue once the console opens, then every 20 seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), 20000);
    return () => clearInterval(id);
  }, [load]);

  const urgent = q?.items.filter((i) => i.escalation.complexity === "critical").length ?? 0;
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded-full bg-ink-950 px-2.5 py-0.5 text-xs font-semibold text-white">Support</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-ink-600">
            {q?.me.name}
            <Button size="sm" variant="ghost" onClick={() => void signOut()} aria-label="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl gap-1 px-4">
          {(["queue", "carriers", "numbers", "system"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn("border-b-2 px-3 py-2 text-sm font-medium", tab === t ? "border-ink-950 text-ink-950" : "border-transparent text-ink-500")}>
              {t === "queue" ? `Waiting on us${q ? ` (${q.items.length})` : ""}` : t === "carriers" ? "Carriers" : t === "numbers" ? "Numbers" : "System"}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {!q && (
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </p>
        )}
        {q && tab === "queue" && (
          <>
            <p className="mb-4 text-sm text-ink-600">
              {q.items.length === 0 ? "Nothing waiting. The AI is handling everything." : `${q.items.length} waiting${urgent ? `, ${urgent} urgent` : ""}. Urgent ones are first; the rest oldest first.`}
            </p>
            <div className="flex flex-col gap-4">
              {q.items.map((item) => (
                <QueueCard key={`${item.carrier.id}:${item.escalation.id}`} item={item} onDone={load} />
              ))}
            </div>
          </>
        )}
        {q && tab === "numbers" && <Numbers />}
        {q && tab === "system" && <SystemHealth />}
        {q && tab === "carriers" && (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            {q.carriers.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink-900">{c.name}</p>
                  <p className="text-xs text-ink-500">
                    {c.mc ? `MC ${c.mc} · ` : ""}
                    {AUTONOMY[c.autonomy] ?? c.autonomy}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {c.waiting > 0 && <Badge tone="warning">{c.waiting} waiting</Badge>}
                  {c.ownerPhone && (
                    <Button size="sm" variant="outline" href={tel(c.ownerPhone)}>
                      <Phone className="h-3.5 w-3.5" /> Owner {formatPhone(c.ownerPhone)}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

interface Metrics {
  trucks: number;
  week: Window;
  month: Window;
  costs?: CarrierCost[];
}
interface Window {
  repeats?: { pattern: string; count: number; toSupport: number; example: string; kind: keyof typeof PLAYBOOK }[];
  handoffs: number;
  toOwner: number;
  perTruckPerWeek: number;
  byKind: Partial<Record<keyof typeof PLAYBOOK, number>>;
  medianMinutesToClose: number | null;
  late: number;
}

interface CarrierCost {
  carrier: string;
  trucks: number;
  aiCalls: number;
  ai: number;
  texts: number;
  emails: number;
  callTurns: number;
  total: number;
}

/** How much still needs people. Hand-offs per truck per week is the number to push down. */
function Numbers() {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/support/metrics", { headers: await authHeader() }).catch(() => null);
      if (res?.ok) setM((await res.json()) as Metrics);
    })();
  }, []);
  if (!m) return <p className="text-sm text-ink-500">Loading</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["week", "month"] as const).map((w) => (
          <div key={w} className="rounded-2xl border border-line bg-white p-4">
            <p className="text-sm font-semibold text-ink-950">Last {w === "week" ? "7" : "30"} days</p>
            <p className="mt-2 text-3xl font-semibold text-ink-950">{m[w].perTruckPerWeek}</p>
            <p className="text-xs text-ink-500">hand-offs to support per truck per week ({m.trucks} trucks)</p>
            <p className="mt-3 text-sm text-ink-700">
              {m[w].handoffs} to support · {m[w].toOwner} to owners · {m[w].late} late
              {m[w].medianMinutesToClose !== null ? ` · closed in ${m[w].medianMinutesToClose} min (median)` : ""}
            </p>
            <ul className="mt-2 text-xs text-ink-600">
              {Object.entries(m[w].byKind)
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .map(([k, n]) => (
                  <li key={k}>
                    {PLAYBOOK[k as keyof typeof PLAYBOOK].label}: {n}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      {!!m.week.repeats?.length && (
        <div className="rounded-2xl border border-line bg-white p-4">
          <p className="text-sm font-semibold text-ink-950">What came up most this week</p>
          <p className="text-xs text-ink-500">Hand-offs that keep repeating, to support or to owners. Each is the next thing to teach the AI.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {m.week.repeats.map((r) => (
              <li key={r.pattern} className="text-sm text-ink-800">
                <span className="font-semibold">{r.count}×</span> {PLAYBOOK[r.kind]?.label ?? "Other"}
                {r.toSupport ? ` (${r.toSupport} to support)` : ""}: <span className="text-ink-600">{r.example}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Costs rows={m.costs ?? []} />
    </div>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** What each carrier cost to run this month, estimated from the AI's tokens and the texts, emails and calls it sent. */
function Costs({ rows }: { rows: CarrierCost[] }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-semibold text-ink-950">Cost to run, this month</p>
      <p className="text-xs text-ink-500">Estimates: the AI&apos;s tokens, and texts, emails and call turns sent. Set the COST_* rates in the environment to Backroute&apos;s own.</p>
      {!rows.length ? (
        <p className="mt-2 text-sm text-ink-500">Nothing yet this month.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-ink-500">
              <tr>
                <th className="py-1 font-medium">Carrier</th>
                <th className="py-1 font-medium">AI</th>
                <th className="py-1 font-medium">Texts</th>
                <th className="py-1 font-medium">Emails</th>
                <th className="py-1 font-medium">Call turns</th>
                <th className="py-1 font-medium">Total</th>
                <th className="py-1 font-medium">Per truck</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.carrier}>
                  <td className="py-1.5 text-ink-900">{r.carrier}</td>
                  <td className="py-1.5 text-ink-700">
                    {usd(r.ai)} <span className="text-xs text-ink-400">({r.aiCalls})</span>
                  </td>
                  <td className="py-1.5 text-ink-700">{r.texts}</td>
                  <td className="py-1.5 text-ink-700">{r.emails}</td>
                  <td className="py-1.5 text-ink-700">{r.callTurns}</td>
                  <td className="py-1.5 font-medium text-ink-950">{usd(r.total)}</td>
                  <td className="py-1.5 text-ink-700">{r.trucks ? usd(r.total / r.trucks) : "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QueueCard({ item, onDone }: { item: QueueItem; onDone: () => Promise<void> }) {
  const e = item.escalation;
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(e.draft?.body ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const base = { carrierId: item.carrier.id, escalationId: e.id };
  const kind = handoffKind(e);
  // Checked when the queue refreshes (every 20 seconds), which is plenty for a 15-minute target.
  // eslint-disable-next-line react-hooks/purity
  const late = (Date.now() - Date.parse(e.createdAt)) / 60000 > SLA_MINUTES(e);
  const run = async (name: string, body: Record<string, unknown>, after?: () => void) => {
    setBusy(name);
    setProblem(null);
    const err = await act(body);
    setBusy(null);
    if (err) return setProblem(err);
    after?.();
    await onDone();
  };

  return (
    <article className={cn("rounded-2xl border bg-white p-4", e.complexity === "critical" ? "border-line" : "border-line")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {e.complexity === "critical" && (
            <Badge tone="danger">
              <AlertTriangle className="h-3 w-3" /> Urgent
            </Badge>
          )}
          <span className="text-sm font-semibold text-ink-950">{item.carrier.name}</span>
          <Badge tone="neutral">{PLAYBOOK[kind].label}</Badge>
          {late && <Badge tone="danger">Late: over {SLA_MINUTES(e)} minutes</Badge>}
          {e.source && e.source !== "app" && <span className="text-xs uppercase tracking-wider text-ink-400">by {e.source === "sms" ? "text" : e.source === "voice" ? "call" : "email"}</span>}
        </div>
        <span className="text-xs text-ink-500">
          <TimeAgo iso={e.createdAt} />
          {e.supportAssignee ? ` · ${e.supportAssignee} has it` : ""}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-800">{e.reason}</p>
      <details className="mt-2 text-xs text-ink-600">
        <summary className="cursor-pointer font-medium text-ink-800">Playbook: {PLAYBOOK[kind].label.toLowerCase()}</summary>
        <ol className="mt-1 list-decimal pl-5">
          {PLAYBOOK[kind].steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>

      <div className="mt-3 grid gap-2 text-xs text-ink-600 sm:grid-cols-3">
        {item.load && (
          <p>
            <span className="font-medium text-ink-900">{item.load.ref}</span> · {item.load.lane}
            <br />
            {item.load.stage.replace("_", " ")} · {formatCurrency(item.load.rate)}
            {item.truck ? ` · truck ${item.truck.unit}` : ""}
          </p>
        )}
        {item.driver && (
          <p>
            <span className="font-medium text-ink-900">{item.driver.name}</span> · speaks {item.driver.language}
            <br />
            {formatPhone(item.driver.phone)}
            {item.driver.smsOptOut ? " · texted STOP" : ""}
          </p>
        )}
        {item.broker && (
          <p>
            <span className="font-medium text-ink-900">{item.broker.company}</span>
            {item.broker.mc ? ` · MC ${item.broker.mc}` : ""} · {item.broker.verified ? "checked" : "not checked"}
            <br />
            {item.broker.email}
            {item.broker.phone ? ` · ${item.broker.phone}` : ""}
          </p>
        )}
      </div>

      {item.portal && (
        <div className="mt-3 rounded-xl border border-line p-3 text-xs text-ink-600">
          <p>
            <span className="font-medium text-ink-900">Website:</span>{" "}
            <a href={item.portal.url} target="_blank" rel="noreferrer noopener" className="break-all underline underline-offset-2">
              {item.portal.url}
            </a>
          </p>
          {item.portal.note && <p className="mt-1">Where the AI stopped: {item.portal.note}</p>}
          {item.portal.steps.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer font-medium text-ink-800">What the AI did ({item.portal.steps.length} steps)</summary>
              <ol className="mt-1 list-decimal pl-5">
                {item.portal.steps.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ol>
            </details>
          )}
          {item.portal.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.portal.screenshot} alt="What the AI last saw on the website" className="mt-2 max-h-72 w-full rounded-lg border border-line object-contain object-top" />
          )}
        </div>
      )}

      {item.thread.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-xl bg-ink-50 p-3">
          {item.thread.map((m, n) => (
            <p key={n} className="mb-1.5 text-xs leading-relaxed last:mb-0">
              <span className="font-medium text-ink-700">
                {m.direction === "in" ? "→ in" : m.data?.bySupport ? `← ${m.data.bySupport}` : "← AI"} ({m.channel === "voice" ? "call" : m.channel === "sms" ? "text" : "email"}, <TimeAgo iso={m.created_at} />):
              </span>{" "}
              <span className="text-ink-600">{m.data?.subject ? `[${m.data.subject}] ` : ""}{(m.body ?? "").slice(0, 400)}</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!e.supportAssignee && (
          <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void run("take", { ...base, action: "take" })}>
            <Hand className="h-3.5 w-3.5" /> I&apos;ll take it
          </Button>
        )}
        {item.driver && (
          <Button size="sm" variant="outline" href={tel(item.driver.phone)}>
            <Phone className="h-3.5 w-3.5" /> Call {item.driver.name.split(" ")[0]}
          </Button>
        )}
        {item.broker?.phone && (
          <Button size="sm" variant="outline" href={tel(item.broker.phone)}>
            <Phone className="h-3.5 w-3.5" /> Call broker
          </Button>
        )}
        {item.carrier.ownerPhone && (
          <Button size="sm" variant="outline" href={tel(item.carrier.ownerPhone)}>
            <UserRound className="h-3.5 w-3.5" /> Call owner
          </Button>
        )}
      </div>

      {e.draft && (
        <div className="mt-3 rounded-xl border border-line p-3">
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <Mail className="h-3.5 w-3.5" /> The AI&apos;s draft to {e.draft.toName ?? e.draft.to} · {e.draft.subject}
            {e.draft.attachments?.length ? ` · ${e.draft.attachments.map((a) => a.name).join(", ")}` : ""}
          </p>
          <textarea aria-label="Draft" value={draft} onChange={(x) => setDraft(x.target.value)} rows={6} className="mt-2 w-full rounded-lg border border-line bg-ink-50/50 px-3 py-2 text-sm outline-none focus:border-ink-400" />
          <Button size="sm" className="mt-2" disabled={!!busy || !draft.trim()} onClick={() => void run("draft", { ...base, action: "send_draft", body: draft })}>
            {busy === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send it
          </Button>
        </div>
      )}

      {item.driver && !item.driver.smsOptOut && (
        <div className="mt-3 flex gap-2">
          <input aria-label={`Text ${item.driver.name}`} value={text} onChange={(x) => setText(x.target.value)} placeholder={`Text ${item.driver.name.split(" ")[0]} from the dispatch number`} className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink-400" />
          <Button size="sm" variant="outline" disabled={!!busy || !text.trim()} onClick={() => void run("text", { carrierId: item.carrier.id, escalationId: e.id, action: "text_driver", driverId: item.driver!.id, body: text }, () => setText(""))}>
            <MessageSquare className="h-3.5 w-3.5" /> Text
          </Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input aria-label="What you did" value={note} onChange={(x) => setNote(x.target.value)} placeholder="What you did (the owner sees this)" className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink-400" />
        <Button size="sm" disabled={!!busy || !note.trim()} onClick={() => void run("resolve", { ...base, action: "resolve", note })}>
          <Check className="h-3.5 w-3.5" /> Done
        </Button>
        {e.brokerId && item.broker && !item.broker.verified && (
          <Button size="sm" variant="outline" disabled={!!busy || !note.trim()} onClick={() => void run("trust", { ...base, action: "trust_broker", brokerId: item.broker!.id, note })}>
            <Check className="h-3.5 w-3.5" /> Broker checks out
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={!!busy || !note.trim()} onClick={() => void run("owner", { ...base, action: "to_owner", note })}>
          <Undo2 className="h-3.5 w-3.5" /> Owner decides
        </Button>
      </div>
      {problem && <p className="mt-2 text-xs text-[var(--accent-danger)]">{problem}</p>}
    </article>
  );
}

interface HealthCheck {
  key: string;
  label: string;
  level: "ok" | "warn" | "down" | "off";
  detail: string;
}

/** Every part of the system and how it's doing (lib/health). The same checks text support when something goes down. */
function SystemHealth() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/support/health", { headers: await authHeader() });
      if (res.ok) {
        const body = (await res.json()) as { checks: HealthCheck[]; at: string };
        setChecks(body.checks);
        setAt(body.at);
      }
    } catch {
      // Offline: the next tick tries again.
    }
  }, []);
  useEffect(() => {
    // Checked when the tab opens, then every 30 seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);
  if (!checks) return <p className="text-sm text-ink-500">Checking…</p>;
  const mark = { ok: "done", warn: "waiting", down: "needs_you", off: "off" } as const;
  const word: Record<HealthCheck["level"], string> = { ok: "Working", warn: "Look at it", down: "Down", off: "Not set up" };
  const down = checks.filter((c) => c.level === "down").length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-600">
        {down ? `${down} part${down === 1 ? "" : "s"} down. Support's phones were texted.` : "Everything that's set up is working."} Checked {at ? new Date(at).toLocaleTimeString() : ""}.
      </p>
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {checks.map((c) => (
          <div key={c.key} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
            <span className="mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <StatusMark kind={mark[c.level]} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">
                {c.label} <span className="font-normal text-ink-500">· {word[c.level]}</span>
              </p>
              <p className="text-xs text-ink-500">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
