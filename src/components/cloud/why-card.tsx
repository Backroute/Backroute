"use client";

import { Lightbulb, Thermometer, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Load } from "@/lib/types";

/**
 * On a load: why the AI went for it (what it pays, empty miles, home time, the broker, what else there was), what's
 * off about its times, and the reefer readings. Nothing shows when there's nothing to say.
 */
export function WhyCard({ load }: { load: Load }) {
  const lines = load.why?.lines ?? [];
  const warnings = load.scheduleWarnings ?? [];
  const log = load.reeferLog ?? [];
  if (!lines.length && !warnings.length && !log.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4" /> Why the AI did this
        </CardTitle>
      </CardHeader>
      <CardContent className="!pt-2 flex flex-col gap-3">
        {lines.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm text-ink-700">
            {lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-400" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        )}
        {warnings.map((w, i) => (
          <p key={i} className={`flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-sm ${w.hard ? "bg-[var(--dot-danger)]/10 text-ink-900" : "bg-ink-50 text-ink-700"}`}>
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {w.text}
          </p>
        ))}
        {log.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <Thermometer className="h-3.5 w-3.5" /> Reefer readings
            </p>
            <p className="mt-1 text-sm text-ink-700">
              {log
                .slice(-6)
                .map((r) => `${r.tempF}°F${r.pulp ? " pulp" : ""} (${new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})`)
                .join(" · ")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
