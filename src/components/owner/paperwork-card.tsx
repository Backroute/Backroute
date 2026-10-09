"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { useCarrierTrucks } from "@/lib/selectors";
import { PRIMARY_CARRIER_ID } from "@/lib/mock-data";
import { dueWords, paperworkDue } from "@/lib/expiry";
import { updateDriver, updateTruck } from "@/lib/back-office";
import { formatDate } from "@/lib/utils";

const dateInput = "h-8 rounded-lg border border-line bg-white px-2 text-xs tabular outline-none focus:border-ink-400";

/**
 * Every date that keeps a truck or driver legal, in one place: what's coming due (reminders go 30, 14 and 7 days
 * ahead), and the dates themselves to keep current.
 */
export function PaperworkCard() {
  const trucks = useCarrierTrucks();
  const demo = useStore((s) => s.session.mode === "demo");
  const drivers = useStore((s) => s.drivers).filter((d) => !demo || d.carrierId === PRIMARY_CARRIER_ID);
  const insurance = useStore((s) => s.settings.insuranceExpires);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const [now] = useState(() => Date.now());
  const due = paperworkDue({ trucks, drivers, insuranceExpires: insurance, now, horizon: 45 });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Papers and dates
          </CardTitle>
          <CardDescription>Plates, inspections, CDLs, medical cards, insurance and IFTA. Backroute reminds you 30, 14 and 7 days ahead, and stops booking a truck or driver once something runs out.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 !pt-3">
        <ul className="flex flex-col gap-2" aria-label="Coming due">
          {due.map((p) => (
            <li key={p.key} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-950">{p.what}</p>
                <p className="text-xs text-ink-500">{p.todo}</p>
              </div>
              <Badge tone={p.days < 0 ? "danger" : p.days <= 7 ? "danger" : p.days <= 14 ? "warning" : "neutral"}>
                {p.days < 0 ? `Ran out ${formatDate(p.due)}` : `${formatDate(p.due)} · ${dueWords(p.days)}`}
              </Badge>
            </li>
          ))}
          {!due.length && <li className="text-sm text-ink-500">Nothing due in the next 45 days.</li>}
        </ul>

        <details className="rounded-2xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-900">Keep the dates current</summary>
          <div className="mt-3 flex flex-col gap-4 text-sm">
            <label className="flex items-center justify-between gap-3">
              <span className="text-ink-700">Insurance certificate runs out</span>
              <input type="date" aria-label="Insurance runs out" className={dateInput} value={insurance?.slice(0, 10) ?? ""} onChange={(e) => updateSettings({ insuranceExpires: e.target.value || undefined })} />
            </label>
            <div>
              <p className="t-label text-ink-500">Trucks</p>
              <div className="mt-2 flex flex-col gap-2">
                {trucks.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">{t.unitNumber}</span>
                    <span className="flex flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-ink-500">
                        Plates
                        <input type="date" aria-label={`${t.unitNumber} registration runs out`} className={dateInput} value={t.registrationExpires?.slice(0, 10) ?? ""} onChange={(e) => updateTruck(t.id, { registrationExpires: e.target.value || undefined })} />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-ink-500">
                        Inspection
                        <input type="date" aria-label={`${t.unitNumber} inspection due`} className={dateInput} value={t.nextInspectionDue?.slice(0, 10) ?? ""} onChange={(e) => e.target.value && updateTruck(t.id, { nextInspectionDue: new Date(`${e.target.value}T12:00:00Z`).toISOString() })} />
                      </label>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="t-label text-ink-500">Drivers</p>
              <div className="mt-2 flex flex-col gap-2">
                {drivers.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">{d.name}</span>
                    <span className="flex flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-ink-500">
                        CDL
                        <input type="date" aria-label={`${d.name} CDL runs out`} className={dateInput} value={d.cdlExpires?.slice(0, 10) ?? ""} onChange={(e) => updateDriver(d.id, { cdlExpires: e.target.value || undefined })} />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-ink-500">
                        Medical card
                        <input type="date" aria-label={`${d.name} medical card runs out`} className={dateInput} value={d.medCardExpires?.slice(0, 10) ?? ""} onChange={(e) => updateDriver(d.id, { medCardExpires: e.target.value || undefined })} />
                      </label>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
