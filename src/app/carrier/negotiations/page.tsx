"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Mail, MessageSquare, Phone } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/shared/live-dot";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { BrokerTrustBadge } from "@/components/shared/broker-trust-badge";
import { NegotiationComposer } from "@/components/shared/negotiation-composer";
import { VoiceCallModal } from "@/components/shared/voice-call-modal";
import { TruckDriverChip } from "@/components/shared/truck-driver-chip";
import { TimeAgo } from "@/components/shared/time-ago";
import { useCarrierLoads, useBrokerMap, useTruckMap, useDriverMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";

export default function NegotiationsPage() {
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const trucks = useTruckMap();
  const drivers = useDriverMap();
  const sendNegotiationInstruction = useStore((s) => s.actions.sendNegotiationInstruction);
  const [callingLoadId, setCallingLoadId] = useState<string | null>(null);
  const active = loads.filter((l) => l.stage === "negotiating" || l.stage === "rate_confirmed");
  const callingLoad = active.find((l) => l.id === callingLoadId);
  const callingBroker = callingLoad ? brokers.get(callingLoad.brokerId) : undefined;

  const emailCount = active.reduce((s, l) => s + l.messages.filter((m) => m.channel === "email").length, 0);
  const smsCount = active.reduce((s, l) => s + l.messages.filter((m) => m.channel === "sms").length, 0);
  const voiceCount = active.reduce((s, l) => s + l.calls.length, 0);

  return (
    <div>
      <PageHeader title="Negotiations" description={`${active.length} active`} right={<LiveDot />} />

      <div className="px-4 py-6 sm:px-8">
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
            const truck = load.truckId ? trucks.get(load.truckId) : undefined;
            const driver = truck?.driverId ? drivers.get(truck.driverId) : undefined;
            const lastMsg = load.messages[load.messages.length - 1];
            // Whose offer is "last" alternates between the AI and the broker every reply, and the AI's own
            // asks sit close to its target by design (94-100%) — so lastOffer/target mostly measures "did
            // the AI or the broker speak most recently," not how close the deal actually is, and jumps
            // around every message instead of trending toward a close. Track each side's own current
            // position and measure how much of the original gap between them has actually closed instead.
            const aiLastOffer = [...load.messages].reverse().find((m) => m.direction === "outbound" && m.offerAmount)?.offerAmount ?? load.targetRate;
            const brokerLastOffer = [...load.messages].reverse().find((m) => m.direction === "inbound" && m.offerAmount)?.offerAmount ?? null;
            const openGap = Math.max(1, load.targetRate - load.listedRate);
            const progress = brokerLastOffer ? Math.max(0, Math.min(100, 100 - (Math.abs(aiLastOffer - brokerLastOffer) / openGap) * 100)) : 0;
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
                      {broker && <BrokerTrustBadge broker={broker} className="mt-1" />}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {channelsUsed.map((c) => (
                        <ChannelBadge key={c} channel={c} />
                      ))}
                      {load.stage === "rate_confirmed" && <Badge tone="success">Confirmed</Badge>}
                    </div>
                  </div>

                  {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} />}

                  {lastMsg && (
                    <div className="rounded-xl bg-ink-50/70 px-3.5 py-2.5 text-xs text-ink-600">
                      <span className="font-medium text-ink-800">{lastMsg.direction === "outbound" ? "Backroute AI" : broker?.contact}:</span> {lastMsg.content}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-[11px] text-ink-500">
                        <span>Their offer {brokerLastOffer ? formatCurrency(brokerLastOffer) : "—"}</span>
                        <span>Our ask {formatCurrency(aiLastOffer)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-ink-950 transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                    <Link href={`/carrier/loads/${load.id}`} className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-950 hover:underline">
                      Open <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                  {load.stage === "negotiating" && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCallingLoadId(load.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-700 hover:border-ink-300"
                        aria-label="Call AI Dispatcher about this load"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex-1">
                        <NegotiationComposer compact onSend={(text) => sendNegotiationInstruction(load.id, "carrier", text)} />
                      </div>
                    </div>
                  )}
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

      {callingLoad && callingBroker && (
        <VoiceCallModal
          spec={{ kind: "negotiation", loadId: callingLoad.id, actor: "carrier", brokerName: callingBroker.company, origin: callingLoad.lane.origin, dest: callingLoad.lane.destination }}
          onClose={() => setCallingLoadId(null)}
        />
      )}
    </div>
  );
}
