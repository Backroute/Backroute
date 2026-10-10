"use client";

import { useState } from "react";
import { Search } from "lucide-react";

/** One place in Settings: its tab, its card's anchor, and the words an owner would type looking for it. */
export interface SettingSpot {
  tab: string;
  id: string;
  title: string;
  words: string;
  /** Only in a signed-in account, or only in the demo. */
  only?: "real" | "demo";
}

export const SETTING_SPOTS: SettingSpot[] = [
  { tab: "basics", id: "set-basics", title: "Your lowest rate, empty miles and home time", words: "lowest rate per mile floor minimum rpm price deadhead empty miles email delay wait undo home time days off end-of-day text monday review", only: "real" },
  { tab: "general", id: "set-company", title: "Company profile", words: "legal name mc dot number fleet size company" },
  { tab: "general", id: "set-channels", title: "Phone, text and email", words: "dispatch phone number line sms text email calls whatsapp voice" },
  { tab: "general", id: "set-business", title: "Rates, billing and check-ins", words: "detention layover tonu invoice payment terms quick pay factoring check-ins check calls remit", only: "real" },
  { tab: "general", id: "set-rules", title: "Your rules", words: "rules without asking automatic approve learned", only: "real" },
  { tab: "general", id: "set-portals", title: "Broker websites", words: "portal website login password broker site", only: "real" },
  { tab: "general", id: "set-papers", title: "Your papers", words: "w-9 w9 coi insurance certificate authority mc letter voided check noa documents papers", only: "real" },
  { tab: "general", id: "set-connections", title: "ELD, load boards and feeds", words: "eld samsara motive dat truckstop load board feed connect keys", only: "real" },
  { tab: "general", id: "set-history", title: "Bring your history", words: "import past loads history csv rate cons spreadsheet", only: "real" },
  { tab: "general", id: "set-quickbooks", title: "QuickBooks Online", words: "quickbooks qbo accounting books bookkeeping", only: "real" },
  { tab: "general", id: "set-exports", title: "Downloads", words: "export download csv payroll bookkeeper invoices iif", only: "real" },
  { tab: "general", id: "set-language", title: "Language", words: "language spanish español english" },
  { tab: "general", id: "set-appearance", title: "Appearance", words: "dark mode light theme colors appearance" },
  { tab: "general", id: "set-autopilot", title: "Autopilot", words: "autopilot ask me first full hands off approve booking" },
  { tab: "general", id: "set-notifications", title: "Notifications", words: "notifications alerts push phone text me email daily text weekly review morning brief drivers" },
  { tab: "integrations", id: "set-integrations", title: "Integrations", words: "integrations tms eld load boards connect" },
  { tab: "addons", id: "set-addons", title: "Add-ons", words: "add-ons addons factoring insurance ifta fuel card" },
  { tab: "billing", id: "set-billing", title: "Billing", words: "billing subscription plan card payment invoice charge price" },
  { tab: "billing", id: "set-team", title: "Who can sign in", words: "team invite dispatcher bookkeeper driver app access sign in members consent" },
  { tab: "billing", id: "set-data", title: "Your data", words: "download everything export zip delete account leave close cancel", only: "real" },
  { tab: "security", id: "set-security", title: "Two-step sign-in and devices", words: "security two-step 2fa code devices sign out password" },
  { tab: "security", id: "set-audit", title: "Changes", words: "audit log changes history who changed" },
];

/**
 * Finding a setting by what it's about instead of guessing which tab holds it: type a few letters, pick the match,
 * and the right tab opens on that card.
 */
export function SettingsSearch({ signedIn, onPick }: { signedIn: boolean; onPick: (spot: SettingSpot) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = query
    ? SETTING_SPOTS.filter((s) => (s.only !== "real" || signedIn) && (s.only !== "demo" || !signedIn) && `${s.title} ${s.words}`.toLowerCase().includes(query)).slice(0, 6)
    : [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            onPick(matches[0]);
            setQ("");
          }
        }}
        placeholder="Search settings: rate, home time, QuickBooks…"
        aria-label="Search settings"
        className="w-full rounded-full border border-line bg-white py-2.5 pl-9 pr-4 text-sm outline-none focus:border-ink-400"
      />
      {query && (
        <ul className="absolute inset-x-0 top-12 z-20 overflow-hidden rounded-2xl border border-line bg-white shadow-lg" role="listbox" aria-label="Matching settings">
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-500">Nothing by that name. Try another word.</li>
          ) : (
            matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onPick(s);
                    setQ("");
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-ink-900 hover:bg-ink-50"
                >
                  {s.title}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
