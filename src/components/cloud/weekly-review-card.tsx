"use client";

import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authHeader } from "@/lib/ai/client";
import { useStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";

interface Review {
  week: string;
  loads: number;
  gross: number;
  net: number;
  emptyPct: number;
  rpm: number | null;
  lastWeekGross: number;
  best: { broker: string; rpm: number } | null;
  worst: { broker: string; why: string } | null;
  change: string;
  learned?: string[];
}

/** Home, real accounts: last week in a minute: the numbers, best and worst broker, and the one thing to change. */
export function WeeklyReviewCard() {
  const signedIn = useStore((s) => s.session.mode !== "demo");
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    void authHeader()
      .then((h) => fetch("/api/review", { headers: h }))
      .then((r) => (r.ok ? r.json() : { review: null }))
      .then((d: { review: Review | null }) => setReview(d.review))
      .catch(() => setReview(null));
  }, [signedIn]);

  if (!review) return null;
  const delta = review.lastWeekGross ? Math.round(((review.gross - review.lastWeekGross) / review.lastWeekGross) * 100) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4" /> Your week
        </CardTitle>
      </CardHeader>
      <CardContent className="!pt-2 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="font-display text-xl tabular text-ink-950">{formatCurrency(review.gross)}</p>
            <p className="text-xs text-ink-500">{review.loads} loads{delta !== null ? ` · ${delta >= 0 ? "+" : ""}${delta}%` : ""}</p>
          </div>
          <div>
            <p className="font-display text-xl tabular text-ink-950">{formatCurrency(review.net)}</p>
            <p className="text-xs text-ink-500">after costs</p>
          </div>
          <div>
            <p className="font-display text-xl tabular text-ink-950">{review.rpm ? `$${review.rpm.toFixed(2)}` : "—"}</p>
            <p className="text-xs text-ink-500">per loaded mile</p>
          </div>
          <div>
            <p className="font-display text-xl tabular text-ink-950">{review.emptyPct}%</p>
            <p className="text-xs text-ink-500">empty miles</p>
          </div>
        </div>
        {(review.best || review.worst) && (
          <p className="text-sm text-ink-700">
            {review.best && <>Best: <span className="font-medium">{review.best.broker}</span> (${review.best.rpm.toFixed(2)}/mi). </>}
            {review.worst && <>Worst: <span className="font-medium">{review.worst.broker}</span>, {review.worst.why}.</>}
          </p>
        )}
        <p className="rounded-2xl bg-ink-50 px-3.5 py-2.5 text-sm text-ink-900">
          <span className="font-medium">One thing to change: </span>
          {review.change}
        </p>
        {review.learned?.length ? (
          <div>
            <p className="text-xs font-semibold text-ink-700">What Backroute learned</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-800">
              {review.learned.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
