"use client";

import { CheckCircle2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierTrucks } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { Aggressiveness } from "@/lib/store";

const AGGRESSIVENESS_OPTIONS: { key: Aggressiveness; label: string; desc: string }[] = [
  { key: "conservative", label: "Conservative", desc: "Holds close to listed rate, escalates often." },
  { key: "balanced", label: "Balanced", desc: "Negotiates firmly, escalates only on edge cases." },
  { key: "aggressive", label: "Aggressive", desc: "Pushes hardest for net profit, walks away fast." },
];

export default function SettingsPage() {
  const carrier = usePrimaryCarrier();
  const trucks = useCarrierTrucks();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.actions.updateSettings);

  return (
    <div>
      <PageHeader title="Settings" description="Tune how aggressively the AI negotiates and books on your behalf." />

      <div className="flex flex-col gap-6 px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Company profile</CardTitle>
          </CardHeader>
          <CardContent className="!pt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Legal name" value={carrier.name} />
            <Field label="MC number" value={carrier.mc} />
            <Field label="DOT number" value={carrier.dot} />
            <Field label="Fleet size" value={`${trucks.length} trucks`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Negotiation aggressiveness</CardTitle>
            <CardDescription>How hard the AI pushes before it accepts, holds, or escalates.</CardDescription>
          </CardHeader>
          <CardContent className="!pt-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {AGGRESSIVENESS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => updateSettings({ aggressiveness: opt.key })}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors",
                    settings.aggressiveness === opt.key ? "border-ink-950 bg-ink-950 text-white" : "border-line hover:border-ink-300",
                  )}
                >
                  <p className="text-sm font-semibold">{opt.label}</p>
                  <p className={cn("mt-1 text-xs", settings.aggressiveness === opt.key ? "text-white/60" : "text-ink-500")}>{opt.desc}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Autonomy</CardTitle>
            </CardHeader>
            <CardContent className="!pt-3 flex flex-col gap-4">
              <ToggleRow
                label="Auto-select when driver doesn't choose"
                desc="If nobody picks a load option within ~15s, AI books its top-scored pick automatically"
                checked={settings.autoBookEnabled}
                onChange={(v) => updateSettings({ autoBookEnabled: v })}
              />
              <ToggleRow label="Avoid low-reliability brokers" desc="Never source or negotiate with 'watch' tier brokers" checked={settings.avoidWatchBrokers} onChange={(v) => updateSettings({ avoidWatchBrokers: v })} />
              <ToggleRow label="Voice agent" desc="Allow the AI to call brokers directly" checked={settings.voiceEnabled} onChange={(v) => updateSettings({ voiceEnabled: v })} />
              <ToggleRow label="SMS agent" desc="Allow rate checks and counters over SMS" checked={settings.smsEnabled} onChange={(v) => updateSettings({ smsEnabled: v })} />
              <ToggleRow label="Email agent" desc="Allow inbox monitoring and negotiation by email" checked={settings.emailEnabled} onChange={(v) => updateSettings({ emailEnabled: v })} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent className="!pt-3 flex flex-col gap-4">
              <ToggleRow label="Email me on escalations" desc="Only when the AI needs your approval" checked={settings.notifyEmail} onChange={(v) => updateSettings({ notifyEmail: v })} />
              <ToggleRow label="Text me on escalations" desc="High-priority exceptions only" checked={settings.notifySms} onChange={(v) => updateSettings({ notifySms: v })} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>TMS integration</CardTitle>
          </CardHeader>
          <CardContent className="!pt-3">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-950 text-white text-xs font-bold">TMS</span>
                <div>
                  <p className="text-sm font-medium text-ink-900">{settings.tmsProvider}</p>
                  <p className="text-xs text-ink-500">Booked loads sync automatically after rate confirmation.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {settings.tmsConnected ? (
                  <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>
                ) : (
                  <Badge tone="warning">Disconnected</Badge>
                )}
                <Button variant="outline" size="sm" onClick={() => updateSettings({ tmsConnected: true })}>
                  <RefreshCw className="h-3.5 w-3.5" /> Sync now
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink-950">{value}</p>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="text-xs text-ink-500">{desc}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
