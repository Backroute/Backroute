"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/mark";
import { updateDriver } from "@/lib/back-office";
import { dueWords, yearAfter } from "@/lib/expiry";
import type { Driver } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type Field = "cdlExpires" | "medCardExpires" | "mvrAt" | "clearinghouseAt";

const ROWS: { field: Field; label: string; kind: "expires" | "done"; how: string }[] = [
  { field: "cdlExpires", label: "CDL", kind: "expires", how: "Runs out on" },
  { field: "medCardExpires", label: "DOT medical card", kind: "expires", how: "Runs out on" },
  { field: "mvrAt", label: "Driving record (MVR) review", kind: "done", how: "Last pulled and reviewed" },
  { field: "clearinghouseAt", label: "Clearinghouse query", kind: "done", how: "Last run" },
];

const DAY = 86400_000;

/**
 * The driver qualification file at a glance: the two things that run out (CDL, medical card) and the two yearly checks
 * (driving record review, Clearinghouse query). Each says when it's next due, and reminders go out 30, 14 and 7 days
 * ahead with the rest of the paperwork. Backroute only keeps the dates; the records themselves stay with the owner.
 */
export function DriverFileCard({ driver }: { driver: Driver }) {
  const [editing, setEditing] = useState<Field | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const rows = ROWS.map((r) => {
    const value = driver[r.field];
    const due = value ? (r.kind === "expires" ? value.slice(0, 10) : yearAfter(value)) : null;
    const days = due ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY) : null;
    return { ...r, value, due, days };
  });
  const missing = rows.filter((r) => !r.value).length;
  const late = rows.filter((r) => r.days !== null && r.days < 0).length;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4" /> Driver file
          </CardTitle>
          <CardDescription>
            {late ? `${late} overdue. ` : ""}
            {missing ? `${missing} date${missing === 1 ? "" : "s"} not on record yet. ` : ""}
            Reminders go out 30, 14 and 7 days before each is due.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="!pt-3">
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
          {rows.map((r) => (
            <li key={r.field} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <StatusMark kind={r.days === null ? "off" : r.days < 0 ? "needs_you" : r.days <= 30 ? "waiting" : "done"} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink-900">{r.label}</span>
                <span className="block text-xs text-ink-500">
                  {r.value
                    ? `${r.how} ${formatDate(r.value)}${r.kind === "done" && r.due ? ` · next due ${formatDate(r.due)}` : ""} (${dueWords(r.days ?? 0)})`
                    : "Not on record"}
                </span>
              </span>
              {editing === r.field ? (
                <input
                  type="date"
                  autoFocus
                  defaultValue={r.value?.slice(0, 10)}
                  aria-label={`${r.label}: ${r.how.toLowerCase()}`}
                  onBlur={() => setEditing(null)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    updateDriver(driver.id, { [r.field]: e.target.value });
                    setEditing(null);
                  }}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-xs outline-none focus:border-ink-400"
                />
              ) : (
                <button type="button" onClick={() => setEditing(r.field)} className="shrink-0 text-xs font-medium text-ink-700 underline-offset-2 hover:underline">
                  {r.kind === "done" ? (r.value ? "Done again" : "Add date") : r.value ? "Change" : "Add date"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
