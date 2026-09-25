"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { authHeader } from "@/lib/ai/client";
import { openFile, uploadFile, type FileKind } from "@/lib/cloud/files";
import { useStore } from "@/lib/store";

/**
 * What the AI needs to do the paperwork and pricing a dispatcher does: where the money goes, the lowest rate it may
 * ask for or take, and whether it texts drivers on its own.
 */
export function BusinessCard() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const [f, setF] = useState(() => ({
    businessAddress: settings.businessAddress ?? "",
    remitEmail: settings.remitEmail ?? "",
    factoringEmail: settings.factoringEmail ?? "",
    minRpm: settings.minRpm ? settings.minRpm.toFixed(2) : "",
  }));
  const [saved, setSaved] = useState(false);
  const rpm = Number(f.minRpm.replace(/[$\s]/g, ""));
  const bad = [
    f.minRpm && !(rpm >= 0.5 && rpm <= 20) && "a rate per mile between $0.50 and $20",
    f.remitEmail && !/^\S+@\S+\.\S+$/.test(f.remitEmail) && "a real billing email",
    f.factoringEmail && !/^\S+@\S+\.\S+$/.test(f.factoringEmail) && "a real factoring email",
  ].filter(Boolean);

  function save() {
    if (bad.length) return;
    updateSettings({
      businessAddress: f.businessAddress.trim() || undefined,
      remitEmail: f.remitEmail.trim() || undefined,
      factoringEmail: f.factoringEmail.trim() || undefined,
      minRpm: f.minRpm ? Math.round(rpm * 100) / 100 : undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const input = "min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";
  const set = (patch: Partial<typeof f>) => {
    setSaved(false);
    setF((x) => ({ ...x, ...patch }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rates, billing and check-ins</CardTitle>
        <CardDescription>The AI uses these when it prices loads, sends invoices and texts drivers.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
            Lowest rate per loaded mile
            <input className={input} inputMode="decimal" placeholder="e.g. 2.25" value={f.minRpm} onChange={(e) => set({ minRpm: e.target.value })} />
            <span className="font-normal text-ink-500">The AI never asks for or agrees to less. Anything lower comes to you.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
            Billing email
            <input className={input} type="email" placeholder="billing@yourcompany.com" value={f.remitEmail} onChange={(e) => set({ remitEmail: e.target.value })} />
            <span className="font-normal text-ink-500">Goes on invoices, and gets a copy of each one.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700 sm:col-span-2">
            Business address (for invoices)
            <input className={input} placeholder="Street, city, state, ZIP" value={f.businessAddress} onChange={(e) => set({ businessAddress: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700 sm:col-span-2">
            Factoring company email (optional)
            <input className={input} type="email" placeholder="Leave empty if brokers pay you directly" value={f.factoringEmail} onChange={(e) => set({ factoringEmail: e.target.value })} />
            <span className="font-normal text-ink-500">If you factor, invoices and PODs go there instead of to the broker.</span>
          </label>
        </div>
        {bad.length > 0 && <p className="text-xs text-[var(--accent-danger)]">Needs {bad.join(", ")}.</p>}
        <div>
          <Button size="sm" onClick={save} disabled={bad.length > 0}>
            {saved ? <Check className="h-3.5 w-3.5" /> : null} {saved ? "Saved" : "Save"}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <div>
            <p className="text-sm font-medium text-ink-900">Check-ins with drivers</p>
            <p className="text-xs text-ink-500">Texts before pickup and delivery, follow-ups when a driver goes quiet or runs late, and a POD reminder. In each driver&apos;s language.</p>
          </div>
          <Switch checked={settings.checkIns !== false} onChange={(v) => updateSettings({ checkIns: v })} label="Check-ins with drivers" />
        </div>
      </CardContent>
    </Card>
  );
}

const PAPERS: { kind: FileKind; label: string; hint: string; expires?: boolean }[] = [
  { kind: "w9", label: "W-9", hint: "Every broker asks for it at setup." },
  { kind: "coi", label: "Insurance certificate (COI)", hint: "The AI reminds you before it expires.", expires: true },
  { kind: "authority", label: "Operating authority (MC letter)", hint: "From FMCSA." },
  { kind: "noa", label: "Notice of assignment", hint: "Only if you factor." },
];

interface OnFile {
  id: string;
  kind: FileKind;
  name: string;
  expires_on: string | null;
  created_at: string;
}

/** The carrier's papers the AI sends brokers in a setup packet. */
export function DocumentsCard() {
  const [files, setFiles] = useState<OnFile[] | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/files", { headers: await authHeader() });
      if (res.ok) setFiles(((await res.json()) as { files: OnFile[] }).files);
    } catch {
      // Offline: shows nothing on file until the next load.
    }
  }, []);
  useEffect(() => {
    // Loading the list of papers on file once the card opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your papers</CardTitle>
        <CardDescription>When a broker asks to set you up, the AI sends these. Nothing goes out without them.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col divide-y divide-line">
        {PAPERS.map((p) => (
          <PaperRow key={p.kind} paper={p} current={files?.find((f) => f.kind === p.kind)} loading={files === null} onSaved={refresh} />
        ))}
      </CardContent>
    </Card>
  );
}

function PaperRow({ paper, current, loading, onSaved }: { paper: (typeof PAPERS)[number]; current?: OnFile; loading: boolean; onSaved: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File) {
    if (paper.expires && !expires) return setError("Put in the date it expires first.");
    setBusy(true);
    setError(null);
    const r = await uploadFile(paper.kind, file, paper.expires ? { expiresOn: expires } : {});
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setExpires("");
    onSaved();
  }

  const expired = current?.expires_on && current.expires_on < new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900">{paper.label}</p>
          {current ? (
            <p className={`truncate text-xs ${expired ? "text-[var(--accent-danger)]" : "text-ink-500"}`}>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => void openFile(current.id)}>
                {current.name}
              </button>
              {current.expires_on ? ` · ${expired ? "expired" : "expires"} ${current.expires_on}` : ""}
            </p>
          ) : (
            <p className="text-xs text-ink-500">{loading ? "…" : `Not on file. ${paper.hint}`}</p>
          )}
          {error && <p className="text-xs text-[var(--accent-danger)]">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {paper.expires && (
          <input
            type="date"
            aria-label={`${paper.label} expires on`}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="rounded-xl border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-ink-400"
          />
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {current ? "Replace" : "Upload"}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          aria-label={`Upload ${paper.label}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void send(file);
          }}
        />
      </div>
    </div>
  );
}
