"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { OWNER_RULES } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { Escalation } from "@/lib/types";

/**
 * The judgment calls the owner hands to the AI. All off to start: until one is on, those emails wait in Needs you.
 * The AI suggests turning one on after the owner has sent a few of that kind exactly as written.
 */
export function OwnerRulesCard() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const [deadhead, setDeadhead] = useState(String(settings.maxDeadhead ?? 300));
  const miles = Number(deadhead);
  const set = (rule: (typeof OWNER_RULES)[number]["rule"], on: boolean) => updateSettings({ ownerRules: { ...settings.ownerRules, [rule]: on } });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your rules</CardTitle>
        <CardDescription>Calls the AI makes without asking you. Everything else outside your numbers still waits for you.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        {OWNER_RULES.map((r) => (
          <div key={r.rule} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">{r.label}</p>
              <p className="text-xs text-ink-500">{r.detail}</p>
            </div>
            <Switch checked={!!settings.ownerRules?.[r.rule]} onChange={(on) => set(r.rule, on)} label={r.label} />
          </div>
        ))}
        <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">Weekly check-in with each driver</p>
            <p className="text-xs text-ink-500">A &quot;how&apos;s it going?&quot; text in their language. If someone&apos;s unhappy, you&apos;re asked to call them.</p>
          </div>
          <Switch checked={settings.driverCheckins !== false} onChange={(on) => updateSettings({ driverCheckins: on })} label="Weekly check-in with each driver" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">Weekly pay text to drivers</p>
            <p className="text-xs text-ink-500">Their loads, miles and estimated pay before deductions, for drivers paid by the mile or a percentage.</p>
          </div>
          <Switch checked={!!settings.payTexts} onChange={(on) => updateSettings({ payTexts: on })} label="Weekly pay text to drivers" />
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
          Most empty miles to a pickup
          <input
            className="w-24 rounded-xl border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            inputMode="numeric"
            value={deadhead}
            onChange={(e) => setDeadhead(e.target.value.replace(/\D/g, ""))}
            onBlur={() => miles >= 25 && miles <= 1000 && updateSettings({ maxDeadhead: miles })}
          />
          <span className="text-xs font-normal text-ink-500">The AI won&apos;t take a load further away than this.</span>
        </label>
      </CardContent>
    </Card>
  );
}

/** The AI's offer to stop asking about one kind of email: one tap either way. */
export function RuleSuggestion({ escalation }: { escalation: Escalation }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const resolveEscalation = useStore((s) => s.actions.resolveEscalation);
  const rule = escalation.suggestRule!;
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          updateSettings({ ownerRules: { ...settings.ownerRules, [rule]: true } });
          resolveEscalation(escalation.id, true, "carrier", "Turned on: the AI sends these on its own.");
        }}
      >
        <Check className="h-3.5 w-3.5" /> Yes, stop asking
      </Button>
      <Button size="sm" variant="outline" onClick={() => resolveEscalation(escalation.id, false, "carrier", "Keep asking.")}>
        <X className="h-3.5 w-3.5" /> Keep asking me
      </Button>
    </div>
  );
}
