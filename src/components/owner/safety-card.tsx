"use client";

import { useState } from "react";
import { MessageCircle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/mark";
import { updateDriver } from "@/lib/back-office";
import { useNow } from "@/lib/hooks";
import { COACHING, SAFETY_LABEL, safetySummary } from "@/lib/safety";
import type { Driver } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

/**
 * The driver's last 30 days of driving events from the ELD, with a coaching point for each kind and a way to mark it
 * talked through. Coaching is the owner's: Backroute only shows what the ELD saw and keeps the note.
 */
export function SafetyCard({ driver }: { driver: Driver }) {
  const now = useNow();
  const [note, setNote] = useState<Record<string, string>>({});
  if (now === null) return null;
  const s = safetySummary(driver.safetyEvents, now);
  const first = driver.name.split(" ")[0];

  function coach(id: string) {
    const events = (driver.safetyEvents ?? []).map((e) => (e.id === id ? { ...e, coached: { at: new Date().toISOString(), ...(note[id]?.trim() ? { note: note[id].trim() } : {}) } } : e));
    updateDriver(driver.id, { safetyEvents: events });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Safety
          </CardTitle>
          <CardDescription>
            {s.recent.length === 0
              ? "No driving events from the ELD in the last 30 days."
              : `${s.recent.length} event${s.recent.length === 1 ? "" : "s"} in 30 days${s.uncoached ? `, ${s.uncoached} not talked through yet` : ", all talked through"}.`}
          </CardDescription>
        </div>
      </CardHeader>
      {s.recent.length > 0 && (
        <CardContent className="!pt-3 flex flex-col gap-3">
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-600">
            {s.byKind.map(([k, n]) => (
              <span key={k}>
                {SAFETY_LABEL[k]} <span className="font-semibold tabular text-ink-950">{n}</span>
              </span>
            ))}
          </p>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {s.recent.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex items-start gap-2.5">
                  <StatusMark kind={e.coached ? "done" : "waiting"} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-900">
                      {SAFETY_LABEL[e.kind]} <span className="font-normal text-ink-500">· {e.label}</span>
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatDateTime(e.at)}
                      {e.unit ? ` · ${e.unit}` : ""} · from {e.source === "demo" ? "the sample ELD" : e.source === "samsara" ? "Samsara" : "Motive"}
                    </p>
                    {e.coached ? (
                      <p className="mt-1 text-xs text-ink-600">Talked through {formatDateTime(e.coached.at)}{e.coached.note ? `: ${e.coached.note}` : ""}</p>
                    ) : (
                      <p className="mt-1 text-xs text-ink-600">{COACHING[e.kind]}</p>
                    )}
                  </div>
                </div>
                {!e.coached && (
                  <div className="flex flex-wrap items-center gap-2 pl-5">
                    <input
                      value={note[e.id] ?? ""}
                      onChange={(ev) => setNote((n) => ({ ...n, [e.id]: ev.target.value }))}
                      placeholder="Note (optional)"
                      aria-label={`Note on the ${SAFETY_LABEL[e.kind].toLowerCase()} event`}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs outline-none focus:border-ink-400"
                    />
                    <Button size="sm" variant="secondary" onClick={() => coach(e.id)}>
                      Talked to {first}
                    </Button>
                    <Button size="sm" variant="ghost" href={`/carrier/messages?driver=${driver.id}`}>
                      <MessageCircle className="h-3.5 w-3.5" /> Message
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
