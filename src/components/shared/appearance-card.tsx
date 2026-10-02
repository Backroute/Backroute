"use client";

import { ThemePicker } from "./theme-picker";

/** Light or dark screens: a card for Settings and the driver's profile. */
export function AppearanceCard() {
  return (
    <section aria-labelledby="appearance-title" className="rounded-2xl border border-line bg-white p-5">
      <h3 id="appearance-title" className="t-section text-ink-950">
        Appearance
      </h3>
      <p className="mt-1 text-xs text-ink-500">Dark is easier on the eyes at night. Auto follows your phone or computer.</p>
      <ThemePicker className="mt-3 max-w-sm" />
    </section>
  );
}
