"use client";

import { ThemePicker } from "./theme-picker";
import { Switch } from "@/components/ui/switch";
import { chime, haptic, setSounds, useSounds } from "@/lib/feedback";

/** Light or dark screens, and whether this phone chimes: a card for Settings and the driver's profile. */
export function AppearanceCard() {
  const sounds = useSounds();
  return (
    <section aria-labelledby="appearance-title" className="rounded-2xl border border-line bg-white p-5">
      <h3 id="appearance-title" className="t-section text-ink-950">
        Appearance
      </h3>
      <p className="mt-1 text-xs text-ink-500">Dark is easier on the eyes at night. Auto follows your phone or computer.</p>
      <ThemePicker className="mt-3 max-w-sm" />
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-line pt-4">
        <div>
          <p className="text-sm font-medium text-ink-900">Sounds</p>
          <p className="text-xs text-ink-500">A short chime when something&apos;s approved, delivered or paid. Just on this phone.</p>
        </div>
        <Switch
          checked={sounds}
          label="Sounds"
          onChange={(on) => {
            setSounds(on);
            haptic("tap");
            if (on) chime("approve");
          }}
        />
      </div>
    </section>
  );
}
