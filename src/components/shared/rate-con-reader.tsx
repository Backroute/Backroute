"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSearch, Loader2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveAiMark } from "@/components/shared/ai-typing";
import { useStore } from "@/lib/store";
import { readRateCon } from "@/lib/ai/client";
import { agreedTerms } from "@/lib/rate-con-terms";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Broker, Load } from "@/lib/types";

/**
 * Upload the broker's rate con PDF and the real AI reads it: the terms on the paper, and anything that doesn't
 * match what was agreed. Checking it before signing is where carriers lose money most often.
 */
/** A broker sends the rate con once a rate is agreed, so there's nothing to check before negotiating. */
const BEFORE_A_DEAL = new Set(["sourced", "scoring", "offered", "declined"]);

export function RateConReader({ load, broker }: { load: Load; broker: Broker | undefined }) {
  const save = useStore((s) => s.actions.saveRateConReading);
  const demo = useStore((s) => s.session.mode === "demo");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reading = load.rateConReading;

  async function read(file: File) {
    if (file.type && file.type !== "application/pdf") return setError("That isn't a PDF. Upload the rate con the broker sent as a PDF.");
    if (file.size > 10 * 1024 * 1024) return setError("That PDF is over 10 MB. Ask the broker for a smaller copy.");
    setBusy(file.name);
    setError(null);
    const result = await readRateCon(file, agreedTerms(load, broker));
    setBusy(null);
    if (result.ok) save(load.id, { ...result.reading, fileName: file.name, readAt: new Date().toISOString() });
    else
      setError(
        result.reason === "off"
          ? demo
            ? "Reading real PDFs uses the live AI, which is off in the demo."
            : "The AI reader isn't switched on for this account yet."
          : "Couldn't read that PDF. Try again, or check it's the rate con.",
      );
  }

  if (BEFORE_A_DEAL.has(load.stage) && !reading) return null;
  const serious = reading?.mismatches.filter((m) => m.serious) ?? [];
  const minor = reading?.mismatches.filter((m) => !m.serious) ?? [];

  return (
    <Card className={serious.length || (reading && !reading.isRateCon) ? "border-[var(--accent-warn)]/50" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-ink-400" /> Check the broker&apos;s rate con
        </CardTitle>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {reading ? "Check another" : "Upload PDF"}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label="Rate con PDF"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void read(file);
          }}
        />
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3 text-sm">
        {busy ? (
          <p className="flex items-center gap-2 text-ink-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading {busy}. This takes up to a minute.
          </p>
        ) : !reading ? (
          <p className="text-ink-500">
            Upload the rate con the broker sent. The AI reads it and checks the rate, detention, fines, payment terms, dates and broker against what
            was agreed on this load, before anyone signs.
          </p>
        ) : (
          <>
            <div className="flex items-start gap-2">
              {!reading.isRateCon || serious.length ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-warn)]" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-live)]" />
              )}
              <p className="font-medium text-ink-950">{reading.summary}</p>
            </div>

            {[...serious, ...minor].length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wider text-ink-400">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Item</th>
                      <th className="py-1.5 pr-3 font-medium">Agreed</th>
                      <th className="py-1.5 pr-3 font-medium">On the rate con</th>
                      <th className="py-1.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[...serious, ...minor].map((m, n) => (
                      <tr key={n}>
                        <td className="py-2 pr-3 font-medium text-ink-900">{m.item}</td>
                        <td className="py-2 pr-3 text-ink-700">{m.agreed}</td>
                        <td className="py-2 pr-3 text-ink-700">{m.onDoc}</td>
                        <td className="py-2">
                          <Badge tone={m.serious ? "danger" : "neutral"}>{m.serious ? "Fix before signing" : "Note"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {reading.isRateCon && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-ink-50 p-3 text-xs sm:grid-cols-3">
                <Term label="Rate" value={reading.totalRate != null ? formatCurrency(reading.totalRate) : null} />
                <Term label="Broker" value={[reading.broker, reading.brokerMc && `MC ${reading.brokerMc.replace(/^MC[-\s]*/i, "")}`].filter(Boolean).join(" · ") || null} />
                <Term label="Load #" value={reading.loadNumber} />
                <Term label="Pickup" value={reading.pickup} />
                <Term label="Delivery" value={reading.delivery} />
                <Term label="Equipment" value={reading.equipment} />
                <Term label="Detention" value={reading.detention} />
                <Term label="Payment" value={reading.paymentTerms} />
              </dl>
            )}

            {(reading.finesAndFees.length > 0 || reading.otherConcerns.length > 0) && (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-ink-700">
                {reading.finesAndFees.map((f, n) => (
                  <li key={`f${n}`}>Fee or fine: {f}</li>
                ))}
                {reading.otherConcerns.map((c, n) => (
                  <li key={`c${n}`}>{c}</li>
                ))}
              </ul>
            )}

            <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
              <LiveAiMark label="Read by AI" /> {reading.fileName} · {formatDateTime(reading.readAt)} · Check anything important on the PDF yourself before signing.
            </p>
          </>
        )}
        {error && <p className="text-[var(--accent-danger)]">{error}</p>}
      </CardContent>
    </Card>
  );
}

function Term({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-400">{label}</dt>
      <dd className="truncate font-medium text-ink-900" title={value ?? undefined}>
        {value ?? "Not on the rate con"}
      </dd>
    </div>
  );
}
