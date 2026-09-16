"use client";

import Link from "next/link";
import { ArrowUpRight, Handshake, Mail, MessageSquare, Phone } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/shared/live-dot";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { TimeAgo } from "@/components/shared/time-ago";
import { useCarrierLoads, useBrokerMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";

export default function NegotiationsPage() {
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const active = loads.filter((l) => l.stage === "negotiating" || l.stage === "rate_confirmed");

  const emailCount = active.reduce((s, l) => s + l.messages.filter((m) => m.channel === "email").length, 0);
  const smsCount = active.reduce((s, l) => s + l.messages.filter((m) => m.channel === "sms").length, 0);
  const voiceCount = active.reduce((s, l) => s + l.calls.length, 0);

  return (
    <div>
      <PageHeader title="Negotiations" description="Every AI conversation in flight, across email, SMS, and voice." right={<LiveDot />} />

      <div className="px-8 py-6">
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="flex items-center gap-3"><Mail className="h-4 w-4 text-ink-400" /><div><p className="font-display text-2xl tabular text-ink-950">{emailCount}</p><p className="text-xs text-ink-500">Email exchanges</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3"><MessageSquare className="h-4 w-4 text-ink-400" /><div><p className="font-display text-2xl tabular text-ink-950">{smsCount}</p><p className="text-xs text-ink-500">SMS exchanges</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3"><Phone className="h-4 w-4 text-ink-400" /><div><p className="font-display text-2xl tabular text-ink-950">{voiceCount}</p><p className="text-xs text-ink-500">Voice calls</p></div></CardContent></Card>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {active.length === 0 && (
            <p className="py-12 text-center text-sm text-ink-400">No active negotiations right now — the AI is scanning boards for the next load.</p>
          )}
          {active.map((load) => {
            const broker = brokers.get(load.brokerId);
            const lastMsg = load.messages[load.messages.length - 1];
            const lastOffer = [...load.messages].reverse().find((m) => m.offerAmount)?.offerAmount;
            const progress = lastOffer ? Math.min(100, (lastOffer / load.targetRate) * 100) : 0;
            const channelsUsed = Array.from(new Set(load.messages.map((m) => m.channel)));

            return (
              <Card key={load.id}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-ink-950">{load.lane.origin} <span className="text-ink-300">→</span> {load.lane.destination}</p>
                        <LoadScoreBadge score={load.score} size="sm" />
                      </div>
                      <p className="text-xs text-ink-500">{broker?.company} · {broker?.contact}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {channelsUsed.map((c) => (
                        <ChannelBadge key={c} channel={c} />
                      ))}
                      {load.stage === "rate_confirmed" && <Badge tone="success">Confirmed</Badge>}
                    </div>
                  </div>

                  {lastMsg && (
                    <div className="rounded-xl bg-ink-50/70 px-3.5 py-2.5 text-xs text-ink-600">
                      <span className="font-medium text-ink-800">{lastMsg.direction === "outbound" ? "Backroute AI" : broker?.contact}:</span> {lastMsg.content}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-[11px] text-ink-500">
                        <span>Current offer {lastOffer ? formatCurrency(lastOffer) : "—"}</span>
                        <span>Target {formatCurrency(load.targetRate)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-ink-950 transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                    {load.stage === "negotiating" && (
                      <Button size="sm" variant="ghost" onClick={() => requestBetterRate(load.id, "carrier")}>
                        <Handshake className="h-3.5 w-3.5" /> Push for more
                      </Button>
                    )}
                    <Link href={`/carrier/loads/${load.id}`} className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-950 hover:underline">
                      Open <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                  {lastMsg && (
                    <p className="text-[11px] text-ink-400">
                      Last activity <TimeAgo iso={lastMsg.timestamp} />
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
