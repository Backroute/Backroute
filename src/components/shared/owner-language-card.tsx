"use client";

import { Languages } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStore } from "@/lib/store";
import { LANG_INFO, LANGS } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * Two separate things, because many owners run the business in English on screen but talk and text in another
 * language: the language the AI texts the owner in, and whether driver calls on this dashboard read in English or
 * in the owner's own language. Each driver hears the AI in their own language either way; brokers are always English.
 */
export function OwnerLanguageCard() {
  const lang = useStore((s) => s.settings.ownerLanguage);
  const transcriptsIn = useStore((s) => s.settings.transcriptsIn);
  const drivers = useStore((s) => s.drivers);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const talk = Array.from(new Set(drivers.map((d) => d.prefs?.language ?? "en")));
  const pill = (on: boolean) => cn("rounded-full border px-3 py-1.5 text-xs font-medium", on ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600 hover:border-ink-300");
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4" /> Languages
          </CardTitle>
          <CardDescription>
            Each driver hears the AI in their own language. This dashboard is in English; the AI can text you in a different language. Brokers are always handled in English.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-ink-800">Texts and calls to you</p>
          <p className="text-[11px] text-ink-500">Your end-of-day text, and anything else the AI sends you directly.</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Texts and calls to you">
            {LANGS.map((l) => (
              <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} lang={l.code} onClick={() => updateSettings({ ownerLanguage: l.code })} className={pill(lang === l.code)}>
                {l.native}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-800">Driver calls on this dashboard</p>
          <p className="text-[11px] text-ink-500">Every call can be read here translated, with what was actually said a tap away.</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Driver calls on this dashboard">
            <button type="button" role="radio" aria-checked={transcriptsIn === "dashboard"} onClick={() => updateSettings({ transcriptsIn: "dashboard" })} className={pill(transcriptsIn === "dashboard")}>
              In English, like the dashboard
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={transcriptsIn === "mine"}
              disabled={lang === "en"}
              onClick={() => updateSettings({ transcriptsIn: "mine" })}
              className={cn(pill(transcriptsIn === "mine"), lang === "en" && "cursor-not-allowed opacity-40")}
            >
              In {lang === "en" ? "my language" : LANG_INFO[lang].native}
            </button>
          </div>
        </div>
        <p className="text-xs text-ink-500">
          Your drivers talk in: {talk.map((c) => LANG_INFO[c].english).join(", ")}. Drivers pick their calls-and-texts language and their app language separately in the app, or you can set how each one talks on the Fleet page.
        </p>
        <p className="text-[11px] text-ink-400">Demo: the AI&apos;s scripted calls, texts and the driver app&apos;s main screens are translated.</p>
      </CardContent>
    </Card>
  );
}
