"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Mail, MessageSquare, Minus, Phone, Sparkles, Sunset } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeAgo } from "@/components/shared/time-ago";
import { authHeader } from "@/lib/ai/client";
import { formatPhone } from "@/lib/cloud/phone";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Status {
  channels: { ai: boolean; server: boolean; sms: boolean; voice: boolean; email: boolean; dailyText: boolean; number: string | null };
  inboundEmail?: string | null;
  log?: { channel: "sms" | "voice" | "email"; direction: "in" | "out"; counterparty: string | null; body: string | null; created_at: string; data: { subject?: string } }[];
}

const ICON = { sms: MessageSquare, voice: Phone, email: Mail };

/**
 * For a real account: which of the AI's real channels are on, the dispatch number drivers text and call, the email
 * address brokers write to, and the latest of each. Channels are switched on by Backroute (see DEPLOY.md).
 */
export function ChannelsCard() {
  const carrierId = useStore((s) => s.session.carrierId);
  const [status, setStatus] = useState<Status | null>(null);
  const [copied, setCopied] = useState(false);

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
    { icon: Sparkles, label: "AI answers", on: !!c?.ai && !!c?.server, note: "Claude reads and replies for you" },
    { icon: MessageSquare, label: "Texts with drivers", on: !!c?.sms, note: number ? `Drivers text ${number}` : "Drivers text the dispatch number" },
    { icon: Phone, label: "Calls to dispatch", on: !!c?.voice, note: number ? `Drivers call ${number}` : "Drivers call the dispatch number" },
    { icon: Mail, label: "Broker email", on: !!c?.email, note: status?.inboundEmail ? "Brokers write to the address below" : "Brokers email the AI" },
    { icon: Sunset, label: "End-of-day text", on: !!c?.dailyText, note: "A summary to your phone every evening" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone, text and email</CardTitle>
        <CardDescription>How the AI dispatcher reaches your drivers and brokers. It says it&apos;s an AI, and anything it would promise a broker waits for your OK.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
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

        {status?.inboundEmail && (
          <div className="rounded-2xl bg-ink-50 px-4 py-3 text-xs text-ink-600">
            <p>Give brokers this address, or forward rate cons to it. The AI reads them and drafts replies for you to send.</p>
            <button
              type="button"
              className="mt-1.5 flex items-center gap-1.5 font-medium text-ink-950"
              onClick={() => {
                void navigator.clipboard?.writeText(status.inboundEmail!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {status.inboundEmail}
            </button>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-ink-700">Latest</p>
          {!status?.log?.length ? (
            <p className="mt-1.5 text-xs text-ink-400">No texts, calls or emails yet.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {status.log.slice(0, 12).map((m, n) => {
                const Icon = ICON[m.channel];
                const who = m.counterparty?.startsWith("call:") ? "Call" : m.counterparty?.includes("@") ? m.counterparty : m.counterparty ? formatPhone(m.counterparty) : "";
                return (
                  <li key={n} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1 text-ink-700">
                      <span className="font-medium text-ink-900">{m.direction === "in" ? who : `AI → ${who}`}</span>{" "}
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
      </CardContent>
    </Card>
  );
}
