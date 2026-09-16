"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/shared/time-ago";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier } from "@/lib/selectors";

export default function EscalationsPage() {
  const escalations = useStore((s) => s.escalations);
  const resolve = useStore((s) => s.actions.resolveEscalation);
  const carrier = usePrimaryCarrier();

  const open = escalations.filter((e) => e.status === "open");
  const resolved = escalations.filter((e) => e.status === "resolved");

  return (
    <div>
      <PageHeader title="Escalations" description={`${open.length} awaiting review`} />

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
                        <p className="text-sm text-ink-900">{e.reason}</p>
                        <p className="mt-1 text-xs text-ink-400">
                          {carrier.name} · <TimeAgo iso={e.createdAt} /> ·{" "}
                          <Link href={`/carrier/loads/${e.loadId}`} className="inline-flex items-center gap-0.5 text-ink-500 hover:text-ink-950 hover:underline">
                            View load <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="danger" onClick={() => resolve(e.id, false)}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => resolve(e.id, true)}>
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {resolved.length > 0 && (
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Resolved ({resolved.length})</h2>
            <div className="flex flex-col gap-2">
              {resolved.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white px-4 py-3">
                  <p className="text-sm text-ink-500 line-through decoration-ink-300">{e.reason}</p>
                  <Badge tone="success">Resolved</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
