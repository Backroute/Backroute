"use client";

import Link from "next/link";
import { Languages, PhoneCall, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { DISPATCH_LINE, quietState } from "@/lib/dispatch-calls";
import { LANGS, pack } from "@/lib/lang";
import { UI, type UiText } from "@/lib/lang/ui";
import type { Driver, HosStatus } from "@/lib/types";

const DUTIES: HosStatus[] = ["driving", "on_duty", "off_duty", "sleeper"];
const EARLIEST = [undefined, 5, 6, 7, 8];

const uiFor = (driver: Driver) => UI[driver.prefs?.language ?? "en"];

/** Why calls are held right now, in the driver's words, or null when they ring through. */
function quietText(driver: Driver, t: UiText): string | null {
  const q = quietState(driver, new Date());
  if (!q) return null;
  return q.kind === "early" ? t.quiet.early(pack(driver.prefs?.language).hour(q.hour)) : t.quiet[q.kind];
}

/** Duty status as the ELD reports it — the one switch that decides whether the AI's calls ring or wait. */
export function DutyStatusPicker({ driver }: { driver: Driver }) {
  const setDutyStatus = useStore((s) => s.actions.setDutyStatus);
  const t = uiFor(driver);
  return (
    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t.dutyTitle}>
      {DUTIES.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={driver.hosStatus === d}
          onClick={() => setDutyStatus(driver.id, d)}
          className={cn("rounded-full border py-1.5 text-xs font-medium", driver.hosStatus === d ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600")}
        >
          {t.duty[d]}
        </button>
      ))}
    </div>
  );
}

/** One line on Home: will the AI's calls ring right now, and why not. */
export function CallStatusLine({ driver }: { driver: Driver }) {
  const t = uiFor(driver);
  const quiet = quietText(driver, t);
  return (
    <Link href="/driver/profile#calls" className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-sm">
      <span className="flex items-center gap-2 text-ink-700">
        {quiet ? <PhoneOff className="h-4 w-4 text-ink-400" /> : <PhoneCall className="h-4 w-4 text-[var(--accent-live)]" />}
        {quiet ? t.held : t.canCall}
      </span>
      <span className="shrink-0 text-xs text-ink-500">{quiet ?? t.duty[driver.hosStatus]}</span>
    </Link>
  );
}

/** The driver's language: the AI calls and texts in it and the app's main screens switch to it. */
export function LanguageCard({ driver }: { driver: Driver }) {
  const setDriverPrefs = useStore((s) => s.actions.setDriverPrefs);
  const t = uiFor(driver);
  const lang = driver.prefs?.language ?? "en";
  return (
    <section id="language" className="rounded-2xl border border-line p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
        <Languages className="h-3.5 w-3.5" /> {t.language}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Language">
        {LANGS.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={lang === l.code}
            lang={l.code}
            onClick={() => setDriverPrefs(driver.id, { language: l.code })}
            className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", lang === l.code ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600")}
          >
            {l.native}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-500">{t.languageNote}</p>
    </section>
  );
}

/** How the AI dispatcher reaches this driver. The same settings the setup call asks about, for drivers who'd rather tap. */
export function CallSettingsCard({ driver }: { driver: Driver }) {
  const { setDriverPrefs, startSetupCall } = useStore((s) => s.actions);
  const t = uiFor(driver);
  const L = pack(driver.prefs?.language);
  const prefs = driver.prefs ?? {};
  const avoid = prefs.avoidStates ?? [];
  const quiet = quietText(driver, t);
  const radio = (on: boolean) => cn("rounded-full border py-1.5 text-xs font-medium", on ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600");

  return (
    <section id="calls" className="scroll-mt-4 rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{t.settingsTitle}</p>
        <button type="button" onClick={() => startSetupCall(driver.id)} className="flex items-center gap-1 text-xs font-medium text-ink-950 underline-offset-2 hover:underline">
          <PhoneCall className="h-3.5 w-3.5" /> {t.setupOnCall}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-500">{t.settingsIntro}</p>

      <p className="mt-4 text-xs font-medium text-ink-800">{t.reachTitle}</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t.reachTitle}>
        {(["app", "phone"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={(prefs.reach ?? "app") === v} onClick={() => setDriverPrefs(driver.id, { reach: v })} className={radio((prefs.reach ?? "app") === v)}>
            {v === "app" ? t.thisApp : t.myPhone}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-500">
        {(prefs.reach ?? "app") === "phone" ? t.reachPhone(driver.phone, DISPATCH_LINE) : t.reachApp} <span className="text-ink-400">{t.demoBoth}</span>
      </p>

      <p className="mt-4 text-xs font-medium text-ink-800">{t.dutyTitle}</p>
      <div className="mt-1.5">
        <DutyStatusPicker driver={driver} />
      </div>
      <p className={cn("mt-1.5 text-[11px]", quiet ? "text-ink-500" : "text-[var(--accent-live)]")}>
        {quiet ? t.heldNote(quiet) : t.ringThrough} <span className="text-ink-400">{t.eldNote}</span>
      </p>

      <label className="mt-4 flex items-center justify-between gap-3 text-xs font-medium text-ink-800">
        {t.earliest}
        <select
          value={prefs.noCallsBefore ?? ""}
          onChange={(e) => setDriverPrefs(driver.id, { noCallsBefore: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="rounded-full border border-line bg-white px-2.5 py-1 text-xs outline-none focus:border-ink-400"
        >
          {EARLIEST.map((h) => (
            <option key={h ?? "any"} value={h ?? ""}>
              {h === undefined ? t.anyTimeOnDuty : L.hour(h)}
            </option>
          ))}
        </select>
      </label>

      <p className="mt-4 text-xs font-medium text-ink-800">{t.dontSend}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {([
          { state: "NJ", label: t.avoidNJ },
          { state: "CA", label: t.avoidCA },
        ] as const).map((a) => {
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

      <p className="mt-4 text-xs font-medium text-ink-800">{t.newLoads}</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t.newLoads}>
        {(["call", "text"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={(prefs.newLoads ?? "call") === v} onClick={() => setDriverPrefs(driver.id, { newLoads: v })} className={radio((prefs.newLoads ?? "call") === v)}>
            {v === "call" ? t.callMe : t.textMe}
          </button>
        ))}
      </div>
    </section>
  );
}
