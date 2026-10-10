"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { listPapers, openFile, TRUCK_PAPERS, uploadFile, type PaperOnFile, type TruckPaper } from "@/lib/cloud/files";

export const PAPER_LABEL: Record<TruckPaper, string> = {
  cab_card: "Registration (cab card)",
  insurance_card: "Insurance card",
  ifta_license: "IFTA license",
  annual_inspection: "Annual inspection",
};

/** Papers that are usually one for the whole fleet; the rest are per truck. */
const FLEET_WIDE = new Set<TruckPaper>(["insurance_card"]);

/**
 * The papers a driver shows at a roadside inspection, added once by the office: for this truck, or for the whole
 * fleet (the insurance card, usually). The driver sees them in the app, under Profile → Truck papers. Loaded when
 * opened, so a long Fleet page doesn't ask for every truck's at once.
 */
export function TruckPapers({ truckId, unit }: { truckId: string; unit: string }) {
  const [files, setFiles] = useState<PaperOnFile[] | null>(null);
  const [open, setOpen] = useState(false);
  const refresh = async () => setFiles((await listPapers()) ?? []);
  const mine = (kind: TruckPaper) => files?.find((f) => f.kind === kind && f.truck_id === truckId) ?? files?.find((f) => f.kind === kind && !f.truck_id);
  const count = files ? TRUCK_PAPERS.filter((k) => mine(k)).length : null;

  return (
    <details
      className="rounded-xl border border-line px-3 py-2"
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (isOpen && !files) void refresh();
      }}
    >
      <summary className="cursor-pointer list-none text-xs font-medium text-ink-700">
        Papers in the cab {count !== null ? `· ${count} of ${TRUCK_PAPERS.length}` : ""}
        <span className="block font-normal text-ink-400">What {unit}&apos;s driver shows at a roadside inspection, on their phone.</span>
      </summary>
      {open && (
        <div className="mt-2 flex flex-col divide-y divide-line">
          {files === null ? (
            <p className="py-2 text-xs text-ink-400">Loading…</p>
          ) : (
            TRUCK_PAPERS.map((kind) => <PaperLine key={kind} kind={kind} truckId={truckId} current={mine(kind)} onSaved={refresh} />)
          )}
        </div>
      )}
    </details>
  );
}

function PaperLine({ kind, truckId, current, onSaved }: { kind: TruckPaper; truckId: string; current?: PaperOnFile; onSaved: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTrucks, setAllTrucks] = useState(FLEET_WIDE.has(kind));
  const expired = current?.expires_on && current.expires_on < new Date().toISOString().slice(0, 10);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    const r = await uploadFile(kind, file, { ...(allTrucks ? {} : { truckId }), ...(expires ? { expiresOn: expires } : {}) });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setExpires("");
    await onSaved();
  }

  return (
    <div className="flex flex-col gap-1.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink-900">
          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" /> {PAPER_LABEL[kind]}
        </span>
        <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-label={`${PAPER_LABEL[kind]} file`} onChange={(e) => (e.target.files?.[0] ? void send(e.target.files[0]) : null, (e.target.value = ""))} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-800 hover:bg-ink-150">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} {current ? "Replace" : "Add"}
        </button>
      </div>
      {current ? (
        <p className={expired ? "text-[var(--accent-danger)]" : "text-ink-500"}>
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => void openFile(current.id)}>
            {current.name}
          </button>
          {current.truck_id ? "" : " · all trucks"}
          {current.expires_on ? ` · ${expired ? "expired" : "expires"} ${current.expires_on}` : ""}
        </p>
      ) : (
        <p className="text-ink-400">Not added.</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-ink-500">
        <label className="flex items-center gap-1.5">
          Expires
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label={`${PAPER_LABEL[kind]} expires on`} className="rounded-lg border border-line bg-white px-1.5 py-0.5 outline-none focus:border-ink-400" />
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={allTrucks} onChange={(e) => setAllTrucks(e.target.checked)} /> For every truck
        </label>
      </div>
      {error && <p className="text-[var(--accent-danger)]">{error}</p>}
    </div>
  );
}
