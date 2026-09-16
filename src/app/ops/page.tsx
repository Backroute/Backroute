"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowUpRight, LifeBuoy, Mail, MessageSquare, Phone, Radar } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/shared/live-dot";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { useStore } from "@/lib/store";
import { formatCompact, formatCurrency, formatNumber } from "@/lib/utils";

export default function OpsOverviewPage() {
  const carriers = useStore((s) => s.carriers);
  const activity = useStore((s) => s.activity);
  const metrics = useStore((s) => s.liveMetrics);
  const allEscalations = useStore((s) => s.escalations);
  const escalations = useMemo(() => allEscalations.filter((e) => e.status === "open"), [allEscalations]);
  const allIncidents = useStore((s) => s.incidents);
  const activeIncidents = useMemo(() => allIncidents.filter((i) => i.status === "active"), [allIncidents]);
  const trucks = useStore((s) => s.trucks);

  const totalTrucks = carriers.reduce((s, c) => s + c.trucks, 0);
  const gmv = carriers.reduce((s, c) => s + c.gmvMonth, 0);
  const takeRate = carriers.reduce((s, c) => s + c.takeRateRevenue, 0);
  const mrr = carriers.reduce((s, c) => s + c.mrr, 0);

  const topCarriers = [...carriers].sort((a, b) => b.trucks - a.trucks).slice(0, 6);

  return (
    <div>
      <PageHeader title="Mission Control" description="Real-time view of the Backroute agent fleet across every carrier." right={<LiveDot />} />

      <div className="flex flex-col gap-6 px-8 py-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card><CardContent><StatTile label="Carriers on platform" value={carriers.length} sublabel={`${formatNumber(totalTrucks)} trucks tracked`} /></CardContent></Card>
          <Card><CardContent><StatTile label="Platform GMV / mo" value={`$${formatCompact(gmv)}`} sublabel="Freight moved through Backroute" /></CardContent></Card>
          <Card><CardContent><StatTile label="Take-rate revenue" value={formatCurrency(takeRate)} sublabel="2% of GMV, this cycle" /></CardContent></Card>
          <Card><CardContent><StatTile label="MRR" value={formatCurrency(mrr)} sublabel="Subscription fees" /></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Radar className="h-4 w-4" /> Agent fleet, right now
              </CardTitle>
              <p className="mt-1 text-xs text-ink-500">Concurrent negotiation activity across email, SMS, and voice</p>
            </div>
            <Link href="/ops/agents" className="flex items-center gap-1 text-xs font-medium text-ink-950 hover:underline">
              Full monitor <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="!pt-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <MetricPill icon={Phone} label="Live calls" value={metrics.activeCalls} />
              <MetricPill icon={MessageSquare} label="SMS threads" value={metrics.activeSmsThreads} />
              <MetricPill icon={Mail} label="Email threads" value={metrics.activeEmailThreads} />
              <MetricPill icon={Radar} label="Boards scanned" value={metrics.boardsConnected} />
              <MetricPill icon={Radar} label="Loads scanned today" value={metrics.loadsScannedToday} />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Live activity</CardTitle>
              <Link href="/ops/loads" className="flex items-center gap-1 text-xs font-medium text-ink-950 hover:underline">
                Loads <ArrowUpRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent className="!pt-2">
              <ActivityFeed events={activity.slice(0, 9)} />
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className={escalations.length ? "border-[var(--accent-warn)]/40" : undefined}>
              <CardHeader>
                <CardTitle>Escalations</CardTitle>
                <Badge tone={escalations.length ? "warning" : "success"}>{escalations.length} open</Badge>
              </CardHeader>
              <CardContent className="!pt-3">
                <Link href="/ops/escalations" className="text-xs font-medium text-ink-950 hover:underline">
                  Review queue →
                </Link>
              </CardContent>
            </Card>

            <Card className={activeIncidents.length ? "border-[var(--accent-danger)]/40" : undefined}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4" /> Active incidents
                </CardTitle>
                <Badge tone={activeIncidents.length ? "danger" : "success"}>{activeIncidents.length} active</Badge>
              </CardHeader>
              <CardContent className="!pt-3">
                {activeIncidents.length === 0 ? (
                  <p className="text-xs text-ink-400">No breakdowns, accidents, or delays reported.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {activeIncidents.map((incident) => {
                      const truck = trucks.find((t) => t.id === incident.truckId);
                      const done = incident.steps.filter((s) => s.status === "done").length;
                      return (
                        <div key={incident.id} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 capitalize text-ink-700">
                            {incident.type} · {truck?.unitNumber ?? "—"}
                            {incident.humanNotified && <Badge tone="danger">Human notified</Badge>}
                          </span>
                          <span className="tabular text-ink-400">{done}/{incident.steps.length}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top carriers by fleet size</CardTitle>
              </CardHeader>
              <CardContent className="!pt-3">
                <div className="flex flex-col divide-y divide-line">
                  {topCarriers.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink-900">{c.name}</p>
                        <p className="text-xs text-ink-400">{c.plan}</p>
                      </div>
                      <span className="shrink-0 text-xs tabular text-ink-500">{c.trucks} trucks</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricPill({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-ink-50/70 p-4">
      <Icon className="h-4 w-4 text-ink-400" />
      <p className="mt-2 font-display text-2xl tabular text-ink-950">{value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  );
}
