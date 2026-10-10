"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { usePrimaryDriver } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";

const dayAfter = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Asking for days off from Home, under when they're home next, where drivers already think about it, instead of
 * digging into Profile. The owner answers it in Needs you. Not for an owner-operator: their days off are theirs.
 */
export function TimeOffAsk() {
  const driver = usePrimaryDriver();
  const { t, solo } = useDriverUi();
  const requestTimeOff = useStore((s) => s.actions.requestTimeOff);
  const pending = useStore((s) => s.timeOffRequests).find((r) => r.driverId === driver.id && r.status === "pending");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(dayAfter(1));
  const [to, setTo] = useState(dayAfter(1));
  const [why, setWhy] = useState("");
  const [sent, setSent] = useState(false);
  if (solo) return null;

  const field = "rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-400";
  if (!open)
    return (
      <div className="-mt-2 flex items-center justify-between gap-3 px-1 text-sm">
        <span className="truncate text-ink-500">
          {sent ? t.timeOffSent : pending ? `${formatDate(pending.startDate)} – ${formatDate(pending.endDate)} · ${t.timeOffSent}` : ""}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 font-medium text-ink-950 underline-offset-2 hover:underline">
          <CalendarClock className="h-4 w-4" /> {t.timeOff}
        </button>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2.5 rounded-2xl border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!why.trim()) return;
        requestTimeOff(driver.id, from, to < from ? from : to, why.trim());
        setWhy("");
        setOpen(false);
        setSent(true);
      }}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-ink-950">
        <CalendarClock className="h-4 w-4 text-ink-400" /> {t.timeOff}
      </p>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-500">
          {t.timeOffFrom}
          <input type="date" value={from} min={dayAfter(0)} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-500">
          {t.timeOffTo}
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={field} />
        </label>
      </div>
      <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t.timeOffWhy} aria-label={t.timeOffWhy} className={field} />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!why.trim()} className="min-h-11 rounded-full bg-[var(--action)] px-4 py-2 text-sm font-semibold text-[var(--action-ink)] disabled:opacity-40">
          {t.timeOffSend}
        </button>
        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm text-ink-500">
          ✕
        </button>
      </div>
    </form>
  );
}
