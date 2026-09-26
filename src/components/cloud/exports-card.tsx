"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authHeader } from "@/lib/ai/client";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Invoices for the bookkeeper (QuickBooks Online's import columns) and each driver's pay per load, as CSV. */
export function ExportsCard() {
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 7 * 86400_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(kind: "invoices" | "settlements") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/export?kind=${kind}&from=${from}&to=${to}`, { headers: await authHeader() });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `${kind}-${from}-to-${to}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't download it. Check your connection and try again.");
    }
    setBusy(null);
  }

  const input = "rounded-xl border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-ink-400";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Downloads</CardTitle>
        <CardDescription>For your bookkeeper and payroll: invoices in QuickBooks Online&apos;s import format, and each driver&apos;s pay per load before deductions.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-700">
          From <input aria-label="From" type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
          to <input aria-label="To" type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["invoices", "settlements"] as const).map((k) => (
            <Button key={k} size="sm" variant="outline" disabled={!!busy} onClick={() => void download(k)}>
              {busy === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {k === "invoices" ? "Invoices (CSV)" : "Driver pay (CSV)"}
            </Button>
          ))}
        </div>
        {error && <p className="text-xs text-[var(--accent-danger)]">{error}</p>}
      </CardContent>
    </Card>
  );
}
