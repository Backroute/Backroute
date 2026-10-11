"use client";

import { Languages } from "lucide-react";
import { useStore } from "@/lib/store";
import { LANGS } from "@/lib/lang/pack";
import type { Driver } from "@/lib/types";

/**
 * The first thing a new driver sees: their language, asked in every language at once, before any English. It sets
 * both the app's screens and how dispatch talks and texts them; Profile → App changes either later.
 */
export function FirstLanguagePick({ driver }: { driver: Driver }) {
  const setDriverPrefs = useStore((s) => s.actions.setDriverPrefs);
  if (driver.prefs?.langPicked || driver.prefs?.appLanguage) return null;
  return (
    <section aria-label="Language" className="rounded-2xl border border-line p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
        <Languages className="h-4 w-4" /> Language · Idioma · ਭਾਸ਼ਾ · भाषा · Язык · Мова · Langue
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Language">
        {LANGS.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={false}
            lang={l.code}
            onClick={() => setDriverPrefs(driver.id, { appLanguage: l.code, language: l.code, langPicked: true })}
            className="rounded-xl border border-line px-3 py-2.5 text-left text-sm font-medium text-ink-900 hover:border-ink-400"
          >
            {l.native}
          </button>
        ))}
      </div>
    </section>
  );
}
