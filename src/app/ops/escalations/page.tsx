"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Download, LifeBuoy, X } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/shared/time-ago";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier } from "@/lib/selectors";
import { downloadCsv } from "@/lib/csv-export";
import type { Escalation } from "@/lib/types";

/** Hours an escalation has sat open, for the urgency badge — a plain "3d ago" reads as a log entry,
 *  not an SLA signal, so this makes the wait time itself the thing you look at. */
function ageBadge(createdAt: string) {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  const label = hours < 1 ? "<1h open" : hours < 24 ? `${Math.floor(hours)}h open` : `${Math.floor(hours / 24)}d open`;
  const tone = hours >= 24 ? "danger" : hours >= 8 ? "warning" : "neutral";
  return { label, tone } as const;
}

function exportResolved(resolved: Escalation[], carrierName: string) {
  downloadCsv(
    `escalations-resolved-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Reason", "Carrier", "Load ID", "Complexity", "Resolved By", "Created At", "Resolved At"],
    resolved.map((e) => [e.reason, carrierName, e.loadId, e.complexity, e.resolvedBy ?? "", e.createdAt, e.resolvedAt ?? ""]),
  );
}

export default function EscalationsPage() {
  const escalations = useStore((s) => s.escalations);
  const resolve = useStore((s) => s.actions.resolveEscalation);
  const carrier = usePrimaryCarrier();

  const open = escalations.filter((e) => e.status === "open");
  const withSupport = escalations.filter((e) => e.status === "with_support");
  const resolved = escalations.filter((e) => e.status === "resolved");

  return (
    <div>
      <PageHeader title="Escalations" description={`${open.length + withSupport.length} awaiting review`} />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Open ({open.length})</h2>
          {open.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-ink-400">Queue is clear — nothing needs human review.</CardContent></Card>
          ) : (
            <div className="flex flex-col gap-3">
              {open.map((e) => (
                <Card key={e.id} className="border-[var(--accent-warn)]/40">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[var(--accent-warn)]">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={e.complexity === "critical" ? "danger" : "neutral"}>
                            {e.complexity === "critical" ? "Needs judgment call" : "AI has a recommendation"}
                          </Badge>
                          <Badge tone={ageBadge(e.createdAt).tone}>{ageBadge(e.createdAt).label}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-ink-900">{e.reason}</p>
                        {e.complexity === "routine" && e.recommendedLabel && (
                          <p className="mt-0.5 text-xs text-ink-500">AI recommends: {e.recommendedLabel}</p>
                        )}
                        <p className="mt-1 text-xs text-ink-400">
                          {carrier.name} · <TimeAgo iso={e.createdAt} />
                          {e.loadId && (
                            <>
                              {" · "}
                              <Link href={`/ops/loads/${e.loadId}`} className="inline-flex items-center gap-0.5 text-ink-500 hover:text-ink-950 hover:underline">
                                View load <ArrowUpRight className="h-3 w-3" />
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="danger" onClick={() => resolve(e.id, false, "ops")}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => resolve(e.id, true, "ops")}>
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {withSupport.length > 0 && (
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">With support ({withSupport.length})</h2>
            <div className="flex flex-col gap-3">
              {withSupport.map((e) => (
                <Card key={e.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
                        <LifeBuoy className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={ageBadge(e.createdAt).tone}>{ageBadge(e.createdAt).label}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-ink-900">{e.reason}</p>
                        <p className="mt-1 text-xs text-ink-400">
                          {carrier.name} routed this to support · <TimeAgo iso={e.createdAt} /> ·{" "}
                          <Link href={`/ops/loads/${e.loadId}`} className="inline-flex items-center gap-0.5 text-ink-500 hover:text-ink-950 hover:underline">
                            View load <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="danger" onClick={() => resolve(e.id, false, "ops")}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => resolve(e.id, true, "ops")}>
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {resolved.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Resolved ({resolved.length})</h2>
              <Button size="sm" variant="secondary" onClick={() => exportResolved(resolved, carrier.name)}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {resolved.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white px-4 py-3">
                  <p className="text-sm text-ink-500 line-through decoration-ink-300">{e.reason}</p>
                  <div className="flex items-center gap-2">
                    {e.resolvedAt && <span className="text-xs text-ink-400"><TimeAgo iso={e.resolvedAt} /></span>}
                    <Badge tone="success">
                      {e.resolvedBy === "support" ? "Resolved by support" : e.resolvedBy === "ops" ? "Resolved by Ops" : "Resolved by carrier"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
