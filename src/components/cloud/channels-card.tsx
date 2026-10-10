"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Mail, MessageSquare, Minus, Phone, Sparkles, Sunset } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { TimeAgo } from "@/components/shared/time-ago";
import { authHeader } from "@/lib/ai/client";
import { formatPhone } from "@/lib/cloud/phone";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { EmailSetup, type EmailSetupStatus } from "./email-setup";

interface Status {
  channels: { ai: boolean; server: boolean; sms: boolean; voice: boolean; email: boolean; dailyText: boolean; number: string | null };
  inboundEmail?: string | null;
  emailSetup?: EmailSetupStatus;
  log?: { channel: "sms" | "voice" | "email"; direction: "in" | "out"; counterparty: string | null; body: string | null; created_at: string; data: { subject?: string }; provider_id?: string | null }[];
  outbound?: { channel: "sms" | "voice" | "email"; recipient: string; subject: string | null; body: string | null; status: "held" | "retry" | "gave_up"; data: { kind?: string }; created_at: string }[];
}

const who = (to: string | null | undefined) => (!to ? "" : to.startsWith("call:") ? "Call" : to.includes("@") ? to : formatPhone(to));

const ICON = { sms: MessageSquare, voice: Phone, email: Mail };

/**
 * For a real account: which of the AI's real channels are on, the dispatch number drivers text and call, the email
 * address brokers write to, and the latest of each. Channels are switched on by Backroute (see DEPLOY.md).
 */
export function ChannelsCard() {
  const carrierId = useStore((s) => s.session.carrierId);
  const practice = useStore((s) => !!s.settings.sandbox);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const [status, setStatus] = useState<Status | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/status?carrier=${encodeURIComponent(carrierId ?? "")}`, { headers: await authHeader() });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      // Offline: the card just stays empty until the next try.
    }
  }, [carrierId]);

  useEffect(() => {
    // Loading the card's data from the server once it opens, then every 30 seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = setInterval(() => void refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!carrierId) return null;
  const c = status?.channels;
  const number = c?.number ? formatPhone(c.number) : null;
  const rows = [
    { icon: Sparkles, label: "Automatic answers", on: !!c?.ai && !!c?.server, note: "Claude reads and replies for you" },
    { icon: MessageSquare, label: "Texts with drivers", on: !!c?.sms, note: number ? `Drivers text ${number}` : "Drivers text the dispatch number" },
    { icon: Phone, label: "Calls to dispatch", on: !!c?.voice, note: number ? `Drivers call ${number}` : "Drivers call the dispatch number" },
    { icon: Mail, label: "Broker email", on: !!c?.email, note: status?.inboundEmail ? "Brokers write to the address below" : "Brokers email Backroute" },
    { icon: Sunset, label: "End-of-day text", on: !!c?.dailyText, note: "A summary to your phone every evening" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone, text and email</CardTitle>
        <CardDescription>How Backroute reaches your drivers and brokers. It says it&apos;s an AI, and anything it would promise a broker waits for your OK.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
        <PracticeMode on={practice} onChange={(on) => updateSettings({ sandbox: on })} held={(status?.outbound ?? []).filter((m) => m.status === "held")} />
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <r.icon className="h-4 w-4 shrink-0 text-ink-400" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{r.label}</p>
                  <p className="truncate text-xs text-ink-500">{r.note}</p>
                </div>
              </div>
              <span className={cn("flex shrink-0 items-center gap-1 text-xs font-medium", r.on ? "text-[var(--accent-live)]" : "text-ink-400")}>
                {r.on ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />} {status ? (r.on ? "On" : "Not set up yet") : "…"}
              </span>
            </li>
          ))}
        </ul>

        {status?.inboundEmail && <EmailSetup address={status.inboundEmail} setup={status.emailSetup ?? null} onRefresh={refresh} />}

        <div>
          <p className="text-xs font-medium text-ink-700">Latest</p>
          {!status?.log?.length ? (
            <p className="mt-1.5 text-xs text-ink-400">No texts, calls or emails yet.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {status.log.slice(0, 20).map((m, n) => {
                const Icon = ICON[m.channel];
                const held = !!m.provider_id?.startsWith("held:");
                return (
                  <li key={n} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1 text-ink-700">
                      <span className="font-medium text-ink-900">{m.direction === "in" ? who(m.counterparty) : `Backroute → ${who(m.counterparty)}`}</span>{" "}
                      {held && <span className="mr-1 rounded bg-ink-100 px-1 py-0.5 text-xs font-medium text-ink-600">not sent: practice</span>}
                      <span className="text-ink-500">{m.data?.subject ? `${m.data.subject}: ` : ""}{(m.body ?? "").slice(0, 140)}</span>
                    </span>
                    <span className="shrink-0 text-ink-400">
                      <TimeAgo iso={m.created_at} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Undelivered items={(status?.outbound ?? []).filter((m) => m.status !== "held")} />
      </CardContent>
    </Card>
  );
}

/**
 * Practice mode: the AI reads everything and decides as usual, but nothing leaves. What it would have sent shows
 * here, so an owner can compare it with what they actually did before letting it talk to anyone.
 */
function PracticeMode({ on, onChange, held }: { on: boolean; onChange: (on: boolean) => void; held: NonNullable<Status["outbound"]> }) {
  return (
    <div className={cn("rounded-2xl border px-4 py-3", on ? "border-ink-900" : "border-line")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-900">Practice mode</p>
          <p className="text-xs text-ink-500">
            Backroute reads your broker email and does its whole job, but sends nothing: no texts, emails or calls. Keep dispatching as you do today and compare.
          </p>
        </div>
        <Switch checked={on} onChange={onChange} label="Practice mode" />
      </div>
      {on && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-700">What Backroute would have sent</p>
          {!held.length ? (
            <p className="mt-1.5 text-xs text-ink-400">Nothing yet. Forward your broker emails to the address below and it starts working.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-2">
              {held.slice(0, 15).map((m, n) => {
                const Icon = ICON[m.channel];
                return (
                  <li key={n} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1 text-ink-700">
                      <span className="font-medium text-ink-900">{m.channel === "voice" ? `Would call ${who(m.recipient)}` : `To ${who(m.recipient)}`}</span>{" "}
                      <span className="whitespace-pre-line text-ink-500">{m.subject ? `${m.subject}: ` : ""}{(m.body ?? "").slice(0, 400)}</span>
                    </span>
                    <span className="shrink-0 text-ink-400">
                      <TimeAgo iso={m.created_at} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Texts and emails a provider outage held up: being sent again, or too old to still send. */
function Undelivered({ items }: { items: NonNullable<Status["outbound"]> }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium text-ink-700">Not delivered yet</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.slice(0, 10).map((m, n) => (
          <li key={n} className="flex items-start gap-2 text-xs">
            <span className={cn("shrink-0 rounded px-1 py-0.5 text-xs font-medium", m.status === "retry" ? "bg-ink-100 text-ink-600" : "bg-ink-100 text-[var(--accent-danger)]")}>
              {m.status === "retry" ? "sending again" : "not sent"}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-600">
              To {who(m.recipient)}: {m.subject ? `${m.subject}: ` : ""}
              {(m.body ?? "").slice(0, 120)}
            </span>
            <span className="shrink-0 text-ink-400">
              <TimeAgo iso={m.created_at} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
