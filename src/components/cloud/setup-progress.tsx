"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { useCarrierDrivers, useCarrierLoads, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const HIDE_KEY = "backroute.setup.hidden";

/**
 * Getting set up, in order, with how far along it is: a truck, its driver, the lowest rate, broker emails coming in,
 * the first load. Each step says why it matters and goes where it's done. Gone once everything's in (or hidden).
 */
export function SetupProgress() {
  const real = useStore((s) => s.session.mode !== "demo");
  const settings = useStore((s) => s.settings);
  const trucks = useCarrierTrucks();
  const drivers = useCarrierDrivers();
  const loads = useCarrierLoads();
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(HIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (!real || hidden) return null;

  const live = loads.filter((l) => !l.imported);
  const steps = [
    { done: trucks.length > 0, title: "Add a truck", why: "So the AI knows what you haul and where it is.", href: "/carrier/fleet", cta: "Add truck" },
    { done: drivers.some((d) => !!d.phone), title: "Add its driver", why: "The AI texts them pickup details and checks in on the road.", href: "/carrier/fleet", cta: "Add driver" },
    { done: !!settings.minRpm, title: "Set your lowest rate", why: "The AI never asks for or agrees to less.", href: "/carrier/settings?tab=basics", cta: "Set it" },
    { done: live.some((l) => l.offerEmail || l.source?.startsWith("Email from")), title: "Send broker emails to Backroute", why: "Forward load offers to your Backroute address and the AI starts pricing them.", href: "/carrier/settings?tab=general", cta: "See your address" },
    { done: live.some((l) => !["sourced", "scoring", "offered", "declined", "cancelled"].includes(l.stage)), title: "Book your first load", why: "Pick one of the offers, or let the AI ask for the best one.", href: "/carrier/loads", cta: "See offers" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);

  return (
    <section aria-labelledby="setup-title" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="setup-title" className="text-sm font-semibold text-ink-950">
            Getting set up
          </h2>
          <p className="mt-0.5 text-xs text-ink-600">
            {doneCount} of {steps.length} done · about {Math.max(1, (steps.length - doneCount) * 1)} minute{steps.length - doneCount === 1 ? "" : "s"} left
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide setup"
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-500 hover:bg-ink-50 sm:h-8 sm:w-8"
          onClick={() => {
            try {
              window.localStorage.setItem(HIDE_KEY, "1");
            } catch {
              // Private browsing: it hides for now.
            }
            setHidden(true);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
        <div className="h-full rounded-full bg-[var(--dot-live)] transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              href={s.href}
              className={cn("flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink-50", i === next && "bg-ink-50")}
              aria-current={i === next ? "step" : undefined}
            >
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", s.done ? "bg-live-soft text-[var(--accent-live)]" : i === next ? "bg-ink-950 text-white" : "bg-ink-100 text-ink-600")}>
                {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", s.done ? "text-ink-500 line-through" : "text-ink-950")}>{s.title}</span>
                {!s.done && i === next && <span className="block text-xs text-ink-600">{s.why}</span>}
              </span>
              {!s.done && i === next && (
                <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-ink-950">
                  {s.cta} <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
