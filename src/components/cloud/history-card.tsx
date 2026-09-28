"use client";

import { useState } from "react";
import { Mail, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authHeader } from "@/lib/ai/client";

interface Result {
  loads: number;
  brokers: number;
  skipped: { line: number; why: string }[];
  columns: Record<string, string>;
  error?: string;
}

const LABEL: Record<string, string> = { date: "Date", broker: "Broker", email: "Email", phone: "Phone", mc: "MC", origin: "From", originState: "From state", destination: "To", destState: "To state", miles: "Miles", rate: "Rate", ref: "Load #", equipment: "Equipment" };

/**
 * Bring your history: a spreadsheet of past loads (from a TMS, QuickBooks or your own sheet), so the AI knows from
 * day one what your lanes pay and how each broker deals. It shows what it found first; nothing is saved until you say.
 */
export function HistoryCard() {
  const [csv, setCsv] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(text: string, dryRun: boolean): Promise<Result> {
    const res = await fetch("/api/import/history", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ csv: text, dryRun }) });
    return (await res.json().catch(() => ({ error: "failed" }))) as Result;
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setDone(null);
    const text = await file.text();
    setCsv(text);
    setName(file.name);
    setPreview(await send(text, true).catch(() => ({ loads: 0, brokers: 0, skipped: [], columns: {}, error: "offline" })));
    setBusy(false);
  }

  async function confirm() {
    if (!csv) return;
    setBusy(true);
    setDone(await send(csv, false).catch(() => ({ loads: 0, brokers: 0, skipped: [], columns: {}, error: "offline" })));
    setBusy(false);
    setPreview(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bring your history</CardTitle>
        <CardDescription>
          A spreadsheet of the loads you&apos;ve hauled this past year (CSV from your TMS, QuickBooks or your own sheet): date, broker, from, to and rate, plus miles and the broker&apos;s email if you have them. The AI prices from it from day one.
        </CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-50">
          <Upload className="h-4 w-4" /> {busy ? "Reading…" : name ? `Pick another file` : "Pick a CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {preview && (
          <div className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-700">
            {preview.error ? (
              <p>Couldn&apos;t read it. Try again.</p>
            ) : (
              <>
                <p className="font-medium text-ink-900">
                  {name}: {preview.loads} load{preview.loads === 1 ? "" : "s"}, {preview.brokers} new broker{preview.brokers === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-ink-500">Columns: {Object.entries(preview.columns).map(([f, c]) => `${LABEL[f] ?? f} ← "${c}"`).join(" · ") || "none found"}</p>
                {preview.skipped.length > 0 && (
                  <p className="mt-1 text-xs text-ink-500">
                    Skipped {preview.skipped.length}: {preview.skipped.slice(0, 4).map((s) => `line ${s.line} (${s.why})`).join(", ")}
                    {preview.skipped.length > 4 ? "…" : ""}
                  </p>
                )}
                {preview.loads > 0 && (
                  <Button size="sm" className="mt-3" disabled={busy} onClick={() => void confirm()}>
                    Import {preview.loads} load{preview.loads === 1 ? "" : "s"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        {done && <p className="text-sm text-ink-700">{done.error ? "The import didn't go through. Try again." : `Imported ${done.loads} loads and ${done.brokers} brokers. The AI uses them for pricing now.`}</p>}
        <RateConHistory />
      </CardContent>
    </Card>
  );
}

interface DocsResult {
  read: number;
  loads: number;
  brokers: number;
  skipped: { file: string; why: string }[];
  error?: string;
}

/**
 * No spreadsheet? Old rate cons work too: upload a batch of PDFs or photos, or forward them from your email to the
 * history address (open for a week). The AI reads each one: the broker, the lane, the rate and the terms.
 */
function RateConHistory() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DocsResult | null>(null);
  const [inbox, setInbox] = useState<{ address: string | null; until: string } | null>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setResult(null);
    const form = new FormData();
    for (const f of Array.from(list).slice(0, 40)) form.append("files", f);
    try {
      const res = await fetch("/api/import/ratecons", { method: "POST", headers: await authHeader(), body: form });
      setResult((await res.json()) as DocsResult);
    } catch {
      setResult({ read: 0, loads: 0, brokers: 0, skipped: [], error: "offline" });
    } finally {
      setBusy(false);
    }
  }

  async function openInbox() {
    const res = await fetch("/api/import/ratecons?inbox=open", { method: "POST", headers: await authHeader() }).catch(() => null);
    if (res?.ok) setInbox((await res.json()) as { address: string | null; until: string });
  }

  return (
    <div className="mt-2 border-t border-line pt-4">
      <p className="text-sm font-medium text-ink-900">Or use your old rate cons</p>
      <p className="mt-0.5 text-xs text-ink-500">Up to 40 PDFs or photos at a time. The AI reads the broker, lane, rate and terms off each one; nothing else is sent anywhere.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-50">
          <Upload className="h-4 w-4" /> {busy ? "Reading them…" : "Upload rate cons"}
          <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(e) => void upload(e.target.files)} />
        </label>
        <Button size="sm" variant="outline" onClick={() => void openInbox()}>
          <Mail className="h-3.5 w-3.5" /> Forward them from my email
        </Button>
      </div>
      {inbox && (
        <p className="mt-2 rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-700">
          {inbox.address ? (
            <>
              Forward emails with rate cons attached (or several at once as attachments) to <span className="font-medium text-ink-950">{inbox.address}</span>. It takes them until {new Date(inbox.until).toLocaleDateString()}.
            </>
          ) : (
            "Email isn't set up for this account yet; upload the files instead."
          )}
        </p>
      )}
      {result && (
        <p className="mt-2 text-sm text-ink-700">
          {result.error
            ? "Couldn't read them. Try again."
            : `Read ${result.read}: ${result.loads} past load${result.loads === 1 ? "" : "s"} and ${result.brokers} new broker${result.brokers === 1 ? "" : "s"} added.${result.skipped.length ? ` Skipped ${result.skipped.length} (${result.skipped.slice(0, 3).map((s) => `${s.file}: ${s.why}`).join("; ")}${result.skipped.length > 3 ? "…" : ""}).` : ""}`}
        </p>
      )}
    </div>
  );
}
