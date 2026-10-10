"use client";

import { useEffect, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { listPapers, openFile, TRUCK_PAPERS, type PaperOnFile, type TruckPaper } from "@/lib/cloud/files";
import { useStore } from "@/lib/store";
import { usePrimaryDriver } from "@/lib/selectors";
import type { UiText } from "@/lib/lang/ui";

const LABEL: Record<TruckPaper, keyof UiText> = { cab_card: "paperCab", insurance_card: "paperIns", ifta_license: "paperIfta", annual_inspection: "paperAnnual" };

/**
 * The truck's papers on the phone, for a roadside inspection: registration (cab card), insurance card, IFTA license
 * and annual inspection, each a tap to show full screen. The office adds them in Fleet. Real accounts only.
 */
export function PapersWallet() {
  const { t } = useDriverUi();
  const driver = usePrimaryDriver();
  const real = useStore((s) => s.session.mode !== "demo");
  const [files, setFiles] = useState<PaperOnFile[] | null>(null);
  useEffect(() => {
    if (!real) return;
    let off = false;
    void listPapers().then((f) => !off && setFiles(f ?? []));
    return () => {
      off = true;
    };
  }, [real]);
  if (!real) return null;
  // This truck's own paper first, else the one for every truck.
  const pick = (kind: TruckPaper) => files?.find((f) => f.kind === kind && f.truck_id === driver.truckId) ?? files?.find((f) => f.kind === kind && !f.truck_id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-2xl border border-line p-4" aria-label={t.papers}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
        <ShieldCheck className="h-3.5 w-3.5" /> {t.papers}
      </p>
      <p className="mt-1 text-xs text-ink-500">{t.papersNote}</p>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {TRUCK_PAPERS.map((kind) => {
          const f = pick(kind);
          const expired = !!f?.expires_on && f.expires_on < today;
          return (
            <li key={kind} className="flex min-h-12 items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-ink-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">{t[LABEL[kind]] as string}</span>
                  {!f && files && <span className="block text-xs text-ink-400">{t.paperMissing}</span>}
                  {expired && <span className="block text-xs text-[var(--accent-danger)]">{t.paperExpired} {f!.expires_on}</span>}
                </span>
              </span>
              {f && (
                <button type="button" onClick={() => void openFile(f.id)} className="min-h-11 shrink-0 rounded-full bg-ink-950 px-4 text-sm font-semibold text-white">
                  {t.paperShow}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
