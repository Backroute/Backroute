"use client";

import Link from "next/link";
import { PhoneCall, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { quietReason } from "@/lib/dispatch-calls";
import type { Driver, HosStatus } from "@/lib/types";

export const DUTY_LABEL: Record<HosStatus, string> = { driving: "Driving", on_duty: "On duty", off_duty: "Off duty", sleeper: "Sleeper" };
const DUTIES: HosStatus[] = ["driving", "on_duty", "off_duty", "sleeper"];
const EARLIEST = [undefined, 5, 6, 7, 8];
const AVOID = [
  { state: "NJ", label: "New Jersey / NYC" },
  { state: "CA", label: "California" },
];

/** Duty status as the ELD reports it — the one switch that decides whether the AI's calls ring or wait. */
export function DutyStatusPicker({ driver }: { driver: Driver }) {
  const setDutyStatus = useStore((s) => s.actions.setDutyStatus);
  return (
    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Duty status">
      {DUTIES.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={driver.hosStatus === d}
          onClick={() => setDutyStatus(driver.id, d)}
          className={cn("rounded-full border py-1.5 text-xs font-medium", driver.hosStatus === d ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600")}
        >
          {DUTY_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

/** One line on Home: will the AI's calls ring right now, and why not. */
export function CallStatusLine({ driver }: { driver: Driver }) {
  const quiet = quietReason(driver, new Date());
  return (
    <Link href="/driver/profile#calls" className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-sm">
      <span className="flex items-center gap-2 text-ink-700">
        {quiet ? <PhoneOff className="h-4 w-4 text-ink-400" /> : <PhoneCall className="h-4 w-4 text-[var(--accent-live)]" />}
        {quiet ? "AI calls held. It texts you instead" : "AI dispatch can call you"}
      </span>
      <span className="shrink-0 text-xs text-ink-500">{quiet ? quiet.replace(`${driver.name.split(" ")[0]}'s`, "You're") : DUTY_LABEL[driver.hosStatus]}</span>
    </Link>
  );
}

/** How the AI dispatcher reaches this driver. The same settings the setup call asks about, for drivers who'd rather tap. */
export function CallSettingsCard({ driver }: { driver: Driver }) {
  const { setDriverPrefs, startSetupCall } = useStore((s) => s.actions);
  const prefs = driver.prefs ?? {};
  const avoid = prefs.avoidStates ?? [];
  const quiet = quietReason(driver, new Date());

  return (
    <section id="calls" className="scroll-mt-4 rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">How the AI calls you</p>
        <button type="button" onClick={() => startSetupCall(driver.id)} className="flex items-center gap-1 text-xs font-medium text-ink-950 underline-offset-2 hover:underline">
          <PhoneCall className="h-3.5 w-3.5" /> Set up on a call
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-500">
        It calls like a dispatcher: new loads, pickup numbers, late appointments, parking. Never while you&apos;re in the sleeper or off duty. Anything with a number also comes by text.
      </p>

      <p className="mt-4 text-xs font-medium text-ink-800">Duty status</p>
      <div className="mt-1.5">
        <DutyStatusPicker driver={driver} />
      </div>
      <p className={cn("mt-1.5 text-[11px]", quiet ? "text-ink-500" : "text-[var(--accent-live)]")}>
        {quiet ? `Calls held: ${quiet.replace(`${driver.name.split(" ")[0]}'s`, "you're").toLowerCase()}. They ring when you're back on duty, if they still matter.` : "Calls ring through."}{" "}
        <span className="text-ink-400">Comes from your ELD on a real truck.</span>
      </p>

      <label className="mt-4 flex items-center justify-between gap-3 text-xs font-medium text-ink-800">
        Earliest call
        <select
          value={prefs.noCallsBefore ?? ""}
          onChange={(e) => setDriverPrefs(driver.id, { noCallsBefore: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="rounded-full border border-line bg-white px-2.5 py-1 text-xs outline-none focus:border-ink-400"
        >
          {EARLIEST.map((h) => (
            <option key={h ?? "any"} value={h ?? ""}>
              {h === undefined ? "Any time on duty" : `${h} AM`}
            </option>
          ))}
        </select>
      </label>

      <p className="mt-4 text-xs font-medium text-ink-800">Don&apos;t send me to</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {AVOID.map((a) => {
          const on = avoid.includes(a.state);
          return (
            <button
              key={a.state}
              type="button"
              aria-pressed={on}
              onClick={() => setDriverPrefs(driver.id, { avoidStates: on ? avoid.filter((s) => s !== a.state) : [...avoid, a.state] })}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", on ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600")}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-xs font-medium text-ink-800">New load options</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="New load options">
        {(["call", "text"] as const).map((v) => {
          const on = (prefs.newLoads ?? "call") === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDriverPrefs(driver.id, { newLoads: v })}
              className={cn("rounded-full border py-1.5 text-xs font-medium", on ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600")}
            >
              {v === "call" ? "Call me" : "Just text me"}
            </button>
          );
        })}
      </div>
    </section>
  );
}
