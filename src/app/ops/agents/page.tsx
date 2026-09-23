"use client";

import { Mail, MessageSquare, Phone, Radar } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/shared/live-dot";
import { CallTranscript } from "@/components/shared/call-transcript";
import { useStore } from "@/lib/store";
import { useCarrierLoads, useBrokerMap } from "@/lib/selectors";

export default function AgentsPage() {
  const metrics = useStore((s) => s.liveMetrics);
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();

  const withMessages = loads.filter((l) => l.messages.length > 0);
  const resolved = loads.filter((l) => l.bookedRate !== null);
  const successRate = withMessages.length ? Math.round((resolved.length / withMessages.length) * 100) : 0;

  const emailCount = loads.reduce((s, l) => s + l.messages.filter((m) => m.channel === "email").length, 0);
  const smsCount = loads.reduce((s, l) => s + l.messages.filter((m) => m.channel === "sms").length, 0);
  const voiceCount = loads.reduce((s, l) => s + l.calls.length, 0);
  const totalMsgs = emailCount + smsCount + voiceCount || 1;

  const recentCalls = [...loads]
    .flatMap((l) => l.calls.map((c) => ({ call: c, load: l })))
    .sort((a, b) => new Date(b.call.startedAt).getTime() - new Date(a.call.startedAt).getTime())
    .slice(0, 4);

  return (
    <div>
      <PageHeader title="Agents" description={`${metrics.activeCalls + metrics.activeSmsThreads + metrics.activeEmailThreads} conversations active`} right={<LiveDot />} />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Metric icon={Phone} value={metrics.activeCalls} label="Calls in progress" />
          <Metric icon={MessageSquare} value={metrics.activeSmsThreads} label="SMS threads" />
          <Metric icon={Mail} value={metrics.activeEmailThreads} label="Email threads" />
          <Metric icon={Radar} value={metrics.boardsConnected} label="Boards connected" />
          <Metric icon={Radar} value={`${successRate}%`} label="Negotiation close rate" />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Channel mix</CardTitle>
            </CardHeader>
            <CardContent className="!pt-4 flex flex-col gap-4">
              <ChannelBar icon={Mail} label="Email" count={emailCount} pct={(emailCount / totalMsgs) * 100} />
              <ChannelBar icon={MessageSquare} label="SMS" count={smsCount} pct={(smsCount / totalMsgs) * 100} />
              <ChannelBar icon={Phone} label="Voice" count={voiceCount} pct={(voiceCount / totalMsgs) * 100} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recent voice calls</CardTitle>
            </CardHeader>
            <CardContent className="!pt-4">
              {recentCalls.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-400">No calls placed yet this session.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {recentCalls.map(({ call, load }) => (
                    <div key={call.id}>
                      <p className="mb-2 text-xs text-ink-500">
                        {load.lane.origin} → {load.lane.destination} · {brokers.get(load.brokerId)?.company}
                      </p>
                      <CallTranscript call={call} defaultCollapsed brokerName={brokers.get(load.brokerId)?.company} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, value, label }: { icon: typeof Phone; value: number | string; label: string }) {
  return (
    <Card>
      <CardContent>
        <Icon className="h-4 w-4 text-ink-400" />
        <p className="mt-2 font-display text-2xl tabular text-ink-950">{value}</p>
        <p className="text-xs text-ink-500">{label}</p>
      </CardContent>
    </Card>
  );
}

function ChannelBar({ icon: Icon, label, count, pct }: { icon: typeof Phone; label: string; count: number; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ink-600">
        <span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</span>
        <span className="tabular">
          {count} <Badge tone="neutral" className="ml-1">{Math.round(pct)}%</Badge>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-ink-950" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
