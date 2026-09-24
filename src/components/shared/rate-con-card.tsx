"use client";

import { AlertTriangle, CheckCircle2, FileCheck2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { savedBy } from "@/lib/rate-con";
import type { Load, RateConIssue } from "@/lib/types";

const ISSUE_STATUS: Record<RateConIssue["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  open: { label: "Asked to fix", tone: "info" },
  fixed: { label: "Fixed", tone: "success" },
  refused: { label: "Broker refused", tone: "warning" },
  accepted: { label: "Accepted as is", tone: "neutral" },
};

/**
 * What the AI found on the rate confirmation versus what was negotiated, and what happened about it. When the
 * broker wouldn't fix something, the owner decides here: sign as is, or walk away before a truck is sent.
 */
export function RateConCard({ load }: { load: Load }) {
  const resolveEscalation = useStore((s) => s.actions.resolveEscalation);
  const review = load.rateCon;
  if (!review) return null;
  const saved = savedBy(review);
  const mc = review.issues.some((i) => i.field === "mc");
  const headline =
    review.status === "checking"
      ? "AI is reading the rate con"
      : review.status === "fixing"
        ? "AI asked the broker for a corrected rate con"
        : review.status === "needs_you"
          ? mc
            ? "Different MC on the rate con. Not signed"
            : "Broker won't fix everything. Your call"
          : review.status === "walked"
            ? "Walked away over the rate con"
            : review.issues.length
              ? "Signed after the AI's corrections"
              : "Matches what was agreed. Signed";

  return (
    <Card className={review.status === "needs_you" ? "border-[var(--accent-warn)]/50" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {review.status === "checking" || review.status === "fixing" ? (
            <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
          ) : review.status === "needs_you" ? (
            <AlertTriangle className="h-4 w-4 text-[var(--accent-warn)]" />
          ) : review.status === "signed" ? (
            <CheckCircle2 className="h-4 w-4 text-[var(--accent-live)]" />
          ) : (
            <FileCheck2 className="h-4 w-4 text-ink-400" />
          )}
          Rate con check
        </CardTitle>
        {saved > 0 && <Badge tone="success">${saved.toLocaleString()} kept</Badge>}
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        <p className="text-sm font-medium text-ink-950">{headline}</p>
        {review.issues.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-ink-400">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Item</th>
                  <th className="py-1.5 pr-3 font-medium">Agreed</th>
                  <th className="py-1.5 pr-3 font-medium">On the rate con</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {review.issues.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-3 font-medium text-ink-900">{i.label}</td>
                    <td className="py-2 pr-3 text-ink-700">{i.agreed}</td>
                    <td className="py-2 pr-3 text-ink-700">{i.onDoc}</td>
                    <td className="py-2">
                      <Badge tone={i.field === "mc" && i.status === "open" ? "danger" : ISSUE_STATUS[i.status].tone}>
                        {i.field === "mc" && i.status === "open" ? "Held" : ISSUE_STATUS[i.status].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {review.status === "needs_you" && review.escalationId && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {mc ? (
              <>
                <Button size="sm" variant="primary" onClick={() => resolveEscalation(review.escalationId!, false, "carrier")}>
                  Walk away from this load
                </Button>
                <Button size="sm" variant="outline" onClick={() => resolveEscalation(review.escalationId!, true, "carrier")}>
                  I confirmed it with the broker. Sign
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="primary" onClick={() => resolveEscalation(review.escalationId!, true, "carrier")}>
                  Accept and sign
                </Button>
                <Button size="sm" variant="outline" onClick={() => resolveEscalation(review.escalationId!, false, "carrier")}>
                  Walk away
                </Button>
              </>
            )}
            <span className="text-[11px] text-ink-500">Nothing is dispatched yet, so walking away costs nothing.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
