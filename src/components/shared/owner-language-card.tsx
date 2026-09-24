"use client";

import { Languages } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStore } from "@/lib/store";
import { LANGS } from "@/lib/lang";
import { cn } from "@/lib/utils";

/** The owner's language: their end-of-day text and every driver call transcript on the dashboard come in it,
 *  whatever language the driver spoke. Brokers are always worked in English. */
export function OwnerLanguageCard() {
  const lang = useStore((s) => s.settings.ownerLanguage);
  const drivers = useStore((s) => s.drivers);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const spoken = Array.from(new Set(drivers.map((d) => d.prefs?.language ?? "en")));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4" /> Languages
          </CardTitle>
          <CardDescription>
            Each driver hears the AI in their own language. You read every call and your end-of-day text in yours. Brokers are always handled in English.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        <p className="text-xs font-medium text-ink-800">Your language</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Your language">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="radio"
              aria-checked={lang === l.code}
              lang={l.code}
              onClick={() => updateSettings({ ownerLanguage: l.code })}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", lang === l.code ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600 hover:border-ink-300")}
            >
              {l.native}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-500">
          Your drivers speak: {spoken.map((c) => LANGS.find((l) => l.code === c)?.english).join(", ")}. Drivers pick their own language in the app, or you can set it on the Fleet page.
        </p>
        <p className="text-[11px] text-ink-400">
          Demo: the AI&apos;s scripted calls, texts and the driver app&apos;s main screens are translated. This dashboard stays in English.
        </p>
      </CardContent>
    </Card>
  );
}
