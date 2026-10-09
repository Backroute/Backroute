"use client";

import { Help } from "@/components/ui/help";
import type { HelpKey } from "@/lib/help";
import { useState } from "react";
import { AutopilotControl } from "@/components/shared/autopilot-control";
import { Switch } from "@/components/ui/switch";
import { HOME_TIME_OPTIONS } from "@/lib/run-types";
import { useCarrierDrivers } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { PhoneAlerts } from "./phone-alerts";

const UNDO = [
  { s: 0, label: "Send at once" },
  { s: 60, label: "1 minute" },
  { s: 90, label: "90 seconds" },
  { s: 300, label: "5 minutes" },
];

/**
 * The five things that decide how the AI dispatches, as plain questions on one screen. Everything else is under
 * More. Each answer saves as soon as it's given.
 */
export function BasicsCard() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const updateHomeTimeTarget = useStore((s) => s.actions.updateHomeTimeTarget);
  const drivers = useCarrierDrivers();
  const [rpm, setRpm] = useState(settings.minRpm ? settings.minRpm.toFixed(2) : "");
  const [miles, setMiles] = useState(String(settings.maxDeadhead ?? 300));
  const [saved, setSaved] = useState<string | null>(null);
  const field = "w-28 rounded-xl border border-line bg-white px-3 py-2.5 text-base tabular outline-none focus:border-ink-500 sm:py-2 sm:text-sm";
  const ok = (what: string) => setSaved(what);

  return (
    <div className="flex flex-col gap-4">
      <Question n={1} help="minRpm" q="What's the lowest you'll take per loaded mile?" hint="Backroute never asks for or agrees to less. Anything lower comes to you.">
        <label className="flex items-center gap-2 text-sm text-ink-800">
          $
          <input
            aria-label="Lowest rate per loaded mile"
            className={field}
            inputMode="decimal"
            placeholder="2.25"
            value={rpm}
            onChange={(e) => setRpm(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={() => {
              const n = Number(rpm);
              if (n >= 0.5 && n <= 15) {
                updateSettings({ minRpm: Math.round(n * 100) / 100 });
                ok("Lowest rate saved");
              }
            }}
          />
          a mile
        </label>
      </Question>

      <Question n={2} help="deadhead" q="How far will you drive empty to a pickup?" hint="Backroute won't take a load further away than this.">
        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input
            aria-label="Most empty miles to a pickup"
            className={field}
            inputMode="numeric"
            value={miles}
            onChange={(e) => setMiles(e.target.value.replace(/\D/g, ""))}
            onBlur={() => {
              const n = Number(miles);
              if (n >= 25 && n <= 1000) {
                updateSettings({ maxDeadhead: n });
                ok("Empty miles saved");
              }
            }}
          />
          miles
        </label>
      </Question>

      <Question n={3} help="autopilot" q="How much can Backroute do without asking?" hint="It always stays inside your numbers above.">
        <AutopilotControl />
        <div className="mt-3">
          <p className="flex items-center gap-1 text-xs font-medium text-ink-700">
            Time to stop Backroute&apos;s emails to brokers before they go <Help topic="undo" />
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Time to stop Backroute's emails">
            {UNDO.map((u) => {
              const on = (settings.undoSeconds ?? 90) === u.s;
              return (
                <button
                  key={u.s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    updateSettings({ undoSeconds: u.s });
                    ok("Saved");
                  }}
                  className={`min-h-11 rounded-full border px-3 py-1.5 text-xs font-medium sm:min-h-0 ${on ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-700"}`}
                >
                  {u.label}
                </button>
              );
            })}
          </div>
        </div>
      </Question>

      <Question n={4} help="homeTime" q="When should each driver get home?" hint="Backroute checks this before every load, and won't book one that makes a driver miss it.">
        {drivers.length ? (
          <ul className="flex flex-col gap-2">
            {drivers.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink-900">{d.name}</span>
                <select
                  aria-label={`When ${d.name} gets home`}
                  className="min-h-11 rounded-xl border border-line bg-white px-3 py-1.5 text-sm sm:min-h-0"
                  value={d.homeTimeTarget}
                  onChange={(e) => {
                    updateHomeTimeTarget(d.id, e.target.value);
                    ok(`${d.name.split(" ")[0]}'s home time saved`);
                  }}
                >
                  {Array.from(new Set([d.homeTimeTarget, ...HOME_TIME_OPTIONS[d.runType]])).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-600">Add your drivers on the Fleet page first.</p>
        )}
      </Question>

      <Question n={5} help="alerts" q="How should we reach you?" hint="Only for what needs you. Routine work just happens.">
        <PhoneAlerts />
        <div className="mt-3 flex flex-col gap-3">
          <Row label="End-of-day text" detail="What got delivered, what it made, what needs you.">
            <Switch checked={settings.dailyText} onChange={(on) => updateSettings({ dailyText: on })} label="End-of-day text" />
          </Row>
          <Row label="Monday review" detail="The week in a minute, and one thing to change.">
            <Switch checked={settings.weeklyReview !== false} onChange={(on) => updateSettings({ weeklyReview: on })} label="Monday review" />
          </Row>
        </div>
      </Question>

      {saved && (
        <p className="text-sm text-ink-700" role="status">
          {saved}.
        </p>
      )}
    </div>
  );
}

function Question({ n, q, hint, help, children }: { n: number; q: string; hint: string; help: HelpKey; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4 sm:p-5" aria-label={q}>
      <p className="text-xs font-semibold text-ink-500">{n} of 5</p>
      <h3 className="mt-0.5 flex items-center gap-1 text-base font-semibold text-ink-950">
        {q} <Help topic={help} />
      </h3>
      <p className="mt-0.5 text-sm text-ink-600">{hint}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="text-xs text-ink-600">{detail}</p>
      </div>
      {children}
    </div>
  );
}
