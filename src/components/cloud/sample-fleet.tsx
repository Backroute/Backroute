"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, GraduationCap, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exitDemo, inSample, sampleAllowed, startSample } from "@/lib/cloud/demo";
import { cloudEnabled } from "@/lib/cloud/client";
import { useStore } from "@/lib/store";
import { useCarrierLoads } from "@/lib/selectors";
import { cn } from "@/lib/utils";

/** What to try on the sample fleet, in the order most owners meet them. */
const STEPS = [
  { key: "approve", title: "Answer something in Needs you", how: "Tap its button, or swipe it right on a phone." },
  { key: "pick", title: "Pick the next load for a truck", how: "Under Pick the next load, choose one of the offers." },
  { key: "ask", title: "Ask the AI a question", how: "Press Ctrl+K (or the search box) and type a question." },
  { key: "timeline", title: "Open a load's timeline", how: "Open any load and look at Timeline on the right." },
  { key: "pause", title: "Pause the AI, then resume it", how: "The status pill at the top: Pause everything, then Resume." },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const DONE_KEY = "backroute.sampleDone";
const listeners = new Set<() => void>();
let cache: string | null = null;
function readDone(): string {
  if (cache !== null) return cache;
  try {
    cache = sessionStorage.getItem(DONE_KEY) ?? "";
  } catch {
    cache = "";
  }
  return cache;
}

/** Ticks a practice step off (only in the sample fleet). */
export function markSample(step: StepKey) {
  if (!inSample()) return;
  const done = new Set(readDone().split(",").filter(Boolean));
  if (done.has(step)) return;
  done.add(step);
  cache = [...done].join(",");
  try {
    sessionStorage.setItem(DONE_KEY, cache);
  } catch {}
  listeners.forEach((l) => l());
}

function useDone(): Set<string> {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readDone,
    () => "",
  );
  return new Set(raw.split(",").filter(Boolean));
}

const useInSample = () =>
  useSyncExternalStore(
    () => () => {},
    inSample,
    () => false,
  );

/** Watches the sample fleet for the practice steps (mounted once, in the owner's layout). */
export function SampleTracker() {
  const sample = useInSample();
  useEffect(() => {
    if (!sample) return;
    return useStore.subscribe((s, prev) => {
      if (s.escalations.some((e) => e.status === "resolved" && prev.escalations.find((p) => p.id === e.id)?.status !== "resolved")) markSample("approve");
      if (s.activity.length > prev.activity.length && s.activity.slice(0, s.activity.length - prev.activity.length).some((a) => a.type === "offer_selected")) markSample("pick");
      if (s.carrierMessages.filter((m) => m.from === "carrier").length > prev.carrierMessages.filter((m) => m.from === "carrier").length) markSample("ask");
      if (s.settings.paused && !prev.settings.paused) markSample("pause");
    });
  }, [sample]);
  return null;
}

/** On Home in the sample fleet: the practice list, ticking off as the owner tries each thing. */
export function SampleChecklist() {
  const sample = useInSample();
  const done = useDone();
  const paused = useStore((s) => !!s.settings.paused);
  if (!sample) return null;
  const count = STEPS.filter((s) => done.has(s.key) && (s.key !== "pause" || !paused)).length;
  return (
    <section aria-labelledby="sample-title" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sample-title" className="t-section flex items-center gap-2 text-ink-950">
            <GraduationCap className="h-4 w-4" /> Practice on the sample fleet
          </h2>
          <p className="mt-0.5 text-xs text-ink-600">
            Made-up trucks and loads. Nothing here is real, saved or sent. {count} of {STEPS.length} tried.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => exitDemo("/carrier")}>
          Back to my fleet
        </Button>
      </div>
      <ol className="mt-3 grid gap-1 sm:grid-cols-2">
        {STEPS.map((s, i) => {
          const ok = done.has(s.key) && (s.key !== "pause" || !paused);
          return (
            <li key={s.key} className="flex items-start gap-3 rounded-xl px-2 py-2">
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", ok ? "bg-live-soft text-[var(--accent-live)]" : "bg-ink-100 text-ink-600")}>
                {ok ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", ok ? "text-ink-500 line-through" : "text-ink-950")}>{s.title}</span>
                {!ok && <span className="block text-xs text-ink-500">{s.how}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** For a real owner who's new: one link into the sample fleet (Home, while setting up). */
export function TrySampleFleet({ className }: { className?: string }) {
  const real = useStore((s) => s.session.mode === "office");
  // Offered while the owner is new: until a few real loads have been booked.
  const booked = useCarrierLoads().filter((l) => !l.imported && !["sourced", "scoring", "offered", "negotiating", "declined"].includes(l.stage)).length;
  const [hidden, setHidden] = useState(false);
  if (!real || !cloudEnabled || !sampleAllowed || hidden || booked >= 3) return null;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3", className)}>
      <p className="text-sm text-ink-700">
        <span className="font-medium text-ink-950">New here?</span> Try it on a sample fleet first: approve, pick loads and talk to the AI with nothing real at stake.
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" onClick={() => startSample("/carrier")}>
          <GraduationCap className="h-3.5 w-3.5" /> Open the sample fleet
        </Button>
        <button type="button" aria-label="Hide" onClick={() => setHidden(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

