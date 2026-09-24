"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Loader2, ShieldCheck, Truck } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { AutopilotControl } from "@/components/shared/autopilot-control";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier } from "@/lib/selectors";
import { RUN_TYPE_DETAIL, RUN_TYPE_LABEL, RUN_TYPES } from "@/lib/run-types";
import { cn } from "@/lib/utils";
import type { RunType } from "@/lib/types";

type Step = "mc" | "eld" | "rules" | "autopilot" | "done";
const STEPS: Step[] = ["mc", "eld", "rules", "autopilot"];
const ELDS = ["Samsara", "Motive", "Geotab", "Other ELD"];
const FLOORS = [
  { pct: 100, label: "Market rate or better", desc: "Fewer loads, higher pay" },
  { pct: 96, label: "A little under market", desc: "The usual balance" },
  { pct: 90, label: "Anything that makes money", desc: "Keeps trucks moving in slow weeks" },
];
const OTR_HOME = ["Home in 1 week", "Home in 2 weeks", "Home in 3 weeks"];

/** Why the AI thinks a driver runs the way it does, from their last 30 days of ELD trips. */
const RUN_EVIDENCE: Record<RunType, string> = {
  intown: "All trips inside 40 miles, 4–6 stops a day",
  local: "Home every night, trips under 150 miles",
  regional: "Out 4–5 nights, home most weekends",
  otr: "Out 2+ weeks at a time, 30 states",
};

/** Five minutes from MC number to trucks being dispatched: the AI looks up the authority and insurance, reads the
 *  fleet off the ELD, and asks the three things only the owner can answer. */
export default function SignupPage() {
  const carrier = usePrimaryCarrier();
  const drivers = useStore((s) => s.drivers);
  const trucks = useStore((s) => s.trucks);
  const { updateSettings, setRunType, updateHomeTimeTarget } = useStore((s) => s.actions);
  const [step, setStep] = useState<Step>("mc");
  const [mc, setMc] = useState("");
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState(false);
  const [eld, setEld] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [floor, setFloor] = useState(96);
  const [otrHome, setOtrHome] = useState("Home in 2 weeks");

  const mcValid = /^\d{5,8}$/.test(mc.replace(/^MC-?/i, ""));
  const stepIndex = STEPS.indexOf(step);

  function lookUp() {
    if (!mcValid) return;
    setLooking(true);
    setTimeout(() => {
      setLooking(false);
      setFound(true);
    }, 1200);
  }

  function connect(name: string) {
    setEld(name);
    setImporting(true);
    setTimeout(() => setImporting(false), 1400);
  }

  function finishRules() {
    updateSettings({ rateFloorPct: floor });
    for (const d of drivers) if (d.runType === "otr") updateHomeTimeTarget(d.id, otrHome);
    setStep("autopilot");
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8 sm:py-12">
        <div className="flex items-center justify-between">
          <Logo />
          {step !== "done" && <p className="text-xs text-ink-500">Step {stepIndex + 1} of 4 · about 5 minutes</p>}
        </div>
        {step !== "done" && (
          <div className="grid grid-cols-4 gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} className={cn("h-1 rounded-full", i <= stepIndex ? "bg-ink-950" : "bg-ink-200")} />
            ))}
          </div>
        )}

        <section className="rounded-3xl border border-line bg-white p-6">
          {step === "mc" && (
            <>
              <h1 className="font-display text-2xl text-ink-950">What&apos;s your MC number?</h1>
              <p className="mt-1 text-sm text-ink-500">The AI looks up your authority and insurance with FMCSA, so you don&apos;t type them in.</p>
              <div className="mt-5 flex gap-2">
                <input
                  value={mc}
                  onChange={(e) => {
                    setMc(e.target.value);
                    setFound(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && lookUp()}
                  inputMode="numeric"
                  placeholder="e.g. 548213"
                  aria-label="MC number"
                  className="min-w-0 flex-1 rounded-full border border-line px-4 py-2.5 text-sm outline-none focus:border-ink-400"
                />
                <Button onClick={lookUp} disabled={!mcValid || looking}>
                  {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
                </Button>
              </div>
              {mc && !mcValid && <p className="mt-2 text-xs text-ink-500">An MC number is 5 to 8 digits.</p>}
              {found && (
                <div className="mt-5 rounded-2xl bg-ink-50 p-4 text-sm">
                  <p className="font-semibold text-ink-950">{carrier.name}</p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-ink-700">
                    <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--accent-live)]" /> Authority active · {carrier.mc} · {carrier.dot}</li>
                    <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--accent-live)]" /> Insurance on file: $1M liability, $100K cargo</li>
                    <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--accent-live)]" /> {carrier.city}, {carrier.state}</li>
                  </ul>
                  <p className="mt-3 text-[11px] text-ink-400">Demo: every MC number shows the demo fleet.</p>
                  <Button className="mt-4 w-full" onClick={() => setStep("eld")}>
                    That&apos;s us <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}

          {step === "eld" && (
            <>
              <h1 className="font-display text-2xl text-ink-950">Connect your ELD</h1>
              <p className="mt-1 text-sm text-ink-500">
                Your trucks, drivers, locations and hours come straight from it. The AI also reads the last 30 days of trips to see how each driver runs.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {ELDS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => connect(name)}
                    className={cn("rounded-2xl border px-4 py-3 text-sm font-medium", eld === name ? "border-ink-950 bg-ink-950 text-white" : "border-line hover:border-ink-300")}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {eld && importing && (
                <p className="mt-5 flex items-center gap-2 text-sm text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading trucks, drivers and 30 days of trips from {eld}…
                </p>
              )}
              {eld && !importing && (
                <div className="mt-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-950">
                    <Truck className="h-4 w-4" /> Found {trucks.length} trucks and {drivers.length} drivers. Check how each one runs:
                  </p>
                  <ul className="mt-3 flex flex-col divide-y divide-line rounded-2xl border border-line">
                    {drivers.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-950">{d.name}</p>
                          <p className="truncate text-xs text-ink-500">{RUN_EVIDENCE[d.runType]}</p>
                        </div>
                        <select
                          value={d.runType}
                          onChange={(e) => setRunType(d.id, e.target.value as RunType)}
                          aria-label={`How ${d.name} runs`}
                          title={RUN_TYPE_DETAIL[d.runType]}
                          className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium outline-none focus:border-ink-400"
                        >
                          {RUN_TYPES.map((t) => (
                            <option key={t} value={t}>{RUN_TYPE_LABEL[t]}</option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-4 w-full" onClick={() => setStep("rules")}>
                    Looks right <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}

          {step === "rules" && (
            <>
              <h1 className="font-display text-2xl text-ink-950">Two things only you can decide</h1>
              <p className="mt-5 text-sm font-medium text-ink-950">Lowest rate you&apos;ll take</p>
              <div className="mt-2 flex flex-col gap-2">
                {FLOORS.map((f) => (
                  <button
                    key={f.pct}
                    type="button"
                    onClick={() => setFloor(f.pct)}
                    className={cn("flex items-center justify-between rounded-2xl border px-4 py-3 text-left", floor === f.pct ? "border-ink-950 bg-ink-950 text-white" : "border-line hover:border-ink-300")}
                  >
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className={cn("text-xs", floor === f.pct ? "text-white/60" : "text-ink-500")}>{f.desc}</span>
                  </button>
                ))}
              </div>
              {drivers.some((d) => d.runType === "otr") && (
                <>
                  <p className="mt-6 text-sm font-medium text-ink-950">How long are long-haul drivers out?</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {OTR_HOME.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setOtrHome(o)}
                        className={cn("rounded-2xl border px-3 py-2.5 text-xs font-medium", otrHome === o ? "border-ink-950 bg-ink-950 text-white" : "border-line hover:border-ink-300")}
                      >
                        {o.replace("Home in ", "")}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="mt-4 text-xs text-ink-500">Local and in-town drivers are home every night; regional drivers pick their weekend day in the app.</p>
              <Button className="mt-5 w-full" onClick={finishRules}>
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}

          {step === "autopilot" && (
            <>
              <h1 className="font-display text-2xl text-ink-950">How much should the AI book on its own?</h1>
              <p className="mt-1 text-sm text-ink-500">Most carriers start with &quot;Ask me first&quot; and move up after a week or two. You can change it any time.</p>
              <div className="mt-5">
                <AutopilotControl />
              </div>
              <Button className="mt-6 w-full" onClick={() => setStep("done")}>
                Finish <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}

          {step === "done" && (
            <div className="text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ink-950 text-white">
                <Check className="h-6 w-6" />
              </span>
              <h1 className="mt-4 font-display text-2xl text-ink-950">You&apos;re set up</h1>
              <p className="mt-1 text-sm text-ink-500">The AI is already looking for loads for your {trucks.length} trucks.</p>
              <Button href="/carrier" className="mt-6 w-full">
                Go to your dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </section>

        {step === "mc" && (
          <p className="text-center text-xs text-ink-500">
            Already have an account? <Link href="/carrier" className="font-medium text-ink-950 underline">Log in</Link>
          </p>
        )}
      </div>
    </div>
  );
}
