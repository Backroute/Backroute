"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface SourceRow {
  id: string;
  label: string;
  sub?: string;
  value: string;
  href?: string;
}

/**
 * A money number that opens where it came from: the loads behind it, each with its share, and how they add up. Wraps
 * whatever shows the number, so any tile can be tapped.
 */
export function MoneySource({
  title,
  how,
  rows,
  total,
  className,
  children,
}: {
  title: string;
  /** One line on how the rows make the number ("Sum of each load's net"). */
  how: string;
  rows: SourceRow[];
  total?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`${title}: where it comes from`} className={cn("text-left", className)}>
        {children}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <p className="text-sm text-ink-500">{how}</p>
        {rows.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">Nothing counts toward this yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-line rounded-2xl border border-line">
            {rows.map((r) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-950">{r.label}</span>
                    {r.sub && <span className="block truncate text-xs text-ink-500">{r.sub}</span>}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular text-ink-950">{r.value}</span>
                  {r.href && <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />}
                </>
              );
              return (
                <li key={r.id}>
                  {r.href ? (
                    <Link href={r.href} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {total && (
          <p className="mt-3 flex items-center justify-between px-1 text-sm font-semibold text-ink-950">
            <span>Total</span>
            <span className="tabular">{total}</span>
          </p>
        )}
      </Sheet>
    </>
  );
}
