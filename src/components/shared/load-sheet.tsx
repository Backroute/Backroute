"use client";

import { useState } from "react";
import { Check, ClipboardList, Copy } from "lucide-react";
import type { Load } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface SheetLabels {
  sheet: string;
  sheetPu: string;
  sheetDel: string;
  sheetFreight: string;
  sheetMust: string;
  sheetRefs: string;
  sheetEmpty: string;
}

export const SHEET_EN: SheetLabels = {
  sheet: "Load sheet",
  sheetPu: "Pickup #",
  sheetDel: "Delivery #",
  sheetFreight: "Freight",
  sheetMust: "Must do",
  sheetRefs: "Other numbers",
  sheetEmpty: "Fills in once the rate con is read.",
};

/** Whether the rate con gave anything for the sheet. */
export function hasSheet(load: Load): boolean {
  const r = load.rateConReading;
  return !!r && !!(r.pickupNumber || r.deliveryNumber || r.commodity || r.pieces || r.weightLbs || r.specialInstructions?.length || r.referenceNumbers?.length);
}

/**
 * What the docks ask for and what the driver must do, read off the rate con: the pickup and delivery numbers (tap to
 * copy), the freight, the special instructions, and every other number on it. Never the rate: this is what a driver
 * gets instead of the rate con itself.
 */
export function LoadSheet({ load, labels = SHEET_EN, tone = "light", className }: { load: Load; labels?: SheetLabels; tone?: "light" | "dark"; className?: string }) {
  const r = load.rateConReading;
  const dark = tone === "dark";
  if (!r || !hasSheet(load))
    return (
      <section className={cn("rounded-2xl border p-4", dark ? "border-white/10" : "border-line", className)} aria-label={labels.sheet}>
        <Title labels={labels} dark={dark} />
        <p className={cn("text-xs", dark ? "text-white/60" : "text-ink-500")}>{labels.sheetEmpty}</p>
      </section>
    );
  const freight = [r.commodity, r.pieces, r.weightLbs ? `${Math.round(r.weightLbs).toLocaleString()} lbs` : null].filter(Boolean).join(" · ");
  const muted = dark ? "text-white/60" : "text-ink-500";
  return (
    <section className={cn("flex flex-col gap-3 rounded-2xl border p-4", dark ? "border-white/10" : "border-line", className)} aria-label={labels.sheet}>
      <Title labels={labels} dark={dark} />
      {(r.pickupNumber || r.deliveryNumber) && (
        <div className="grid grid-cols-2 gap-2">
          {r.pickupNumber && <DockNumber label={labels.sheetPu} value={r.pickupNumber} dark={dark} />}
          {r.deliveryNumber && <DockNumber label={labels.sheetDel} value={r.deliveryNumber} dark={dark} />}
        </div>
      )}
      {freight && (
        <div>
          <p className={cn("text-xs", muted)}>{labels.sheetFreight}</p>
          <p className={cn("text-sm font-medium", dark ? "text-white" : "text-ink-950")}>{freight}</p>
        </div>
      )}
      {!!r.specialInstructions?.length && (
        <div>
          <p className={cn("text-xs", muted)}>{labels.sheetMust}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {r.specialInstructions.map((s) => (
              <li key={s} className={cn("flex gap-2 text-sm", dark ? "text-white/90" : "text-ink-900")}>
                <span aria-hidden className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", dark ? "bg-white/60" : "bg-ink-400")} />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!r.referenceNumbers?.length && (
        <div>
          <p className={cn("text-xs", muted)}>{labels.sheetRefs}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {r.referenceNumbers.map((n) => (
              <div key={`${n.label}${n.value}`} className="contents">
                <dt className={muted}>{n.label}</dt>
                <dd className={cn("tabular font-medium", dark ? "text-white" : "text-ink-950")}>{n.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function Title({ labels, dark }: { labels: SheetLabels; dark: boolean }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", dark ? "text-white/60" : "text-ink-400")}>
      <ClipboardList className="h-3.5 w-3.5" /> {labels.sheet}
    </p>
  );
}

/** A number the dock clerk asks for, big enough to read out, and copied with a tap (for a check-in kiosk or app). */
function DockNumber({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn("flex min-h-14 flex-col items-start rounded-xl px-3 py-2 text-left", dark ? "bg-white/10" : "bg-ink-50")}
    >
      <span className={cn("flex items-center gap-1 text-xs", dark ? "text-white/60" : "text-ink-500")}>
        {label} {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </span>
      <span className={cn("tabular text-base font-semibold break-all", dark ? "text-white" : "text-ink-950")}>{value}</span>
    </button>
  );
}
