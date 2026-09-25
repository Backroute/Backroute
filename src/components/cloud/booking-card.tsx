"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { markBooked } from "@/lib/cloud/agent";
import { openFile } from "@/lib/cloud/files";
import type { Broker, Load } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const STATUS = {
  drafted: "Waiting for you to send the book request (Needs you)",
  sent: "Asked the broker; waiting on their answer",
  accepted: "The broker agreed; waiting on their rate con",
  declined: "The broker passed",
};

/**
 * A real account's load, from the broker side: what the AI asked for and where it stands, the button to book it once
 * the broker confirms, and the paperwork after (invoice, detention). Everything here really went by email.
 */
export function BookingCard({ load, broker }: { load: Load; broker?: Broker }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const req = load.bookRequest;
  const pending = load.stage === "negotiating" || load.stage === "offered";
  if (!req && !load.invoice && !load.detentionClaims?.length && !pending) return null;

  async function book() {
    setBusy(true);
    setProblem(await markBooked(load.id));
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>With the broker</CardTitle>
          <CardDescription>
            {broker?.company ?? "Broker"}
            {load.brokerContactEmail ? ` · ${load.brokerContactEmail}` : ""}. Every email is in Settings → Phone, text and email.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3 text-sm">
        {req && (
          <div className="flex items-start gap-2">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <div>
              <p className="text-ink-900">
                Asked {formatCurrency(req.ask)}
                {req.brokerOffer && req.brokerOffer !== req.ask ? ` · broker offered ${formatCurrency(req.brokerOffer)}` : ""}
                {req.countered ? " · countered once" : ""}
              </p>
              <p className="text-xs text-ink-500">
                {pending ? STATUS[req.status] : load.bookedRate ? `Booked at ${formatCurrency(load.bookedRate)}` : STATUS[req.status]} · {formatDateTime(req.askedAt)}
              </p>
            </div>
          </div>
        )}
        {pending && (
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-600">
              When the broker confirms, the AI books it as soon as their rate con arrives and matches (on Within my rules or Full autopilot). If they confirmed another way, book it here: it goes on the truck and the driver gets a text.
            </p>
            <Button size="sm" className="mt-2" disabled={busy} onClick={book}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} The broker confirmed: book it
            </Button>
            {problem && <p className="mt-1 text-xs text-[var(--accent-danger)]">{problem}</p>}
          </div>
        )}
        {load.detentionClaims?.map((c) => (
          <p key={c.stop} className="text-ink-700">
            Detention at {c.stop}: {Math.round(c.minutes / 6) / 10} h on site, claim {formatCurrency(c.amount)} · {c.sentAt ? `sent ${formatDateTime(c.sentAt)}` : "waiting for you (Needs you)"}
          </p>
        ))}
        {load.invoice && (
          <p className="text-ink-700">
            Invoice {load.invoice.number}, {formatCurrency(load.invoice.amount)} ·{" "}
            {load.invoice.sentAt ? `sent to ${load.invoice.sentTo} ${formatDateTime(load.invoice.sentAt)}` : "waiting for you (Needs you)"}
            {load.invoice.paidAt ? ` · paid ${formatDateTime(load.invoice.paidAt)}` : ""}
          </p>
        )}
        {load.documents.some((d) => d.fileId) && (
          <div className="flex flex-wrap gap-2">
            {load.documents
              .filter((d) => d.fileId)
              .map((d) => (
                <Button key={d.id} size="sm" variant="outline" onClick={() => void openFile(d.fileId!)}>
                  {d.type.toUpperCase().replace("_", " ")}
                </Button>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
