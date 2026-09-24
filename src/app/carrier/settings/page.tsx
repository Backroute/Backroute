"use client";

import { useState } from "react";
import { CheckCircle2, CreditCard, Download, FileText, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { INTEGRATION_CATEGORIES } from "@/lib/integrations";
import { ADDONS } from "@/lib/addons";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierTrucks } from "@/lib/selectors";
import { downloadCsv } from "@/lib/csv-export";
import { AutopilotControl } from "@/components/shared/autopilot-control";
import { DailyTextPreview } from "@/components/shared/daily-text";
import { DispatchLineCard } from "@/components/shared/dispatch-line-card";
import { OwnerLanguageCard } from "@/components/shared/owner-language-card";
import { AppAccessCard } from "@/components/cloud/app-access";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { Aggressiveness } from "@/lib/store";

const TABS = [
  { key: "general", label: "General" },
  { key: "integrations", label: "Integrations" },
  { key: "addons", label: "AI Add-ons" },
  { key: "billing", label: "Billing & Team" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const INVOICES = [
  { id: "inv-1", date: "2026-09-01T00:00:00Z", amount: 3159, status: "Paid" as const },
  { id: "inv-2", date: "2026-08-01T00:00:00Z", amount: 2884, status: "Paid" as const },
  { id: "inv-3", date: "2026-07-01T00:00:00Z", amount: 2611, status: "Paid" as const },
];

const INITIAL_TEAM = [
  { id: "tm-1", name: "Alicia Moreno", email: "alicia@titanfreight.com", role: "Owner" },
  { id: "tm-2", name: "Chris Palmer", email: "chris@titanfreight.com", role: "Ops Manager" },
];

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
  const toggleAddon = useStore((s) => s.actions.toggleAddon);
  const includedAddons = ADDONS.filter((a) => a.model === "included");
  const commissionAddons = ADDONS.filter((a) => a.model === "commission");
  const [team, setTeam] = useState(INITIAL_TEAM);
  // A real account manages who can sign in; the demo keeps its sample team.
  const signedIn = useStore((s) => s.session.mode !== "demo");
  const [inviteEmail, setInviteEmail] = useState("");
  const [connections, setConnections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(INTEGRATION_CATEGORIES.flatMap((c) => c.items).map((i) => [i.id, i.connected])),
  );
  const [tab, setTab] = useState<TabKey>("general");
  const [card, setCard] = useState({ brand: "Visa", last4: "4242", expiry: "08/29" });
  const [editingCard, setEditingCard] = useState(false);
  const [cardNumberInput, setCardNumberInput] = useState("");
  const [cardExpiryInput, setCardExpiryInput] = useState("");

  function handleInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    const name = email.split("@")[0].replace(/[._]/g, " ");
    setTeam((t) => [...t, { id: `tm-${Date.now()}`, name: name.replace(/\b\w/g, (c) => c.toUpperCase()), email, role: "Dispatcher" }]);
    setInviteEmail("");
  }

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="px-4 py-6 sm:px-8">
        <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} active={tab} onChange={(k) => setTab(k as TabKey)} />

        <div className="mt-5 flex flex-col gap-6">
          {tab === "general" && (
            <>
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

              <DispatchLineCard />

              <OwnerLanguageCard />

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
                    <CardTitle>Autopilot</CardTitle>
                  </CardHeader>
                  <CardContent className="!pt-3 flex flex-col gap-4">
                    <AutopilotControl />
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
                    <p className="text-xs text-ink-500">
                      Only three kinds of alerts reach you: something that needs you, money moving, and safety. Everything else the AI does stays in its log.
                    </p>
                    <ToggleRow label="Text me when something needs me" desc="Approvals, loads to pick, drivers' requests" checked={settings.notifySms} onChange={(v) => updateSettings({ notifySms: v })} />
                    <ToggleRow label="Email me a copy of every alert" desc="Needs you, money and safety" checked={settings.notifyEmail} onChange={(v) => updateSettings({ notifyEmail: v })} />
                    <ToggleRow label="End-of-day text at 6 PM" desc="Loads delivered, profit, and anything that needs you tomorrow" checked={settings.dailyText} onChange={(v) => updateSettings({ dailyText: v })} />
                    {settings.dailyText && <DailyTextPreview />}
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {tab === "integrations" && (
            <Card>
              <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>The load boards, TMS, ELD, and back-office tools the AI reads and writes to.</CardDescription>
              </CardHeader>
              <CardContent className="!pt-3 flex flex-col gap-5">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">TMS</p>
                  <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-950 text-[10px] font-bold text-white">
                          {initials(settings.tmsProvider)}
                        </span>
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
                  </div>
                </div>

                {INTEGRATION_CATEGORIES.map((cat) => (
                  <div key={cat.name}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{cat.name}</p>
                    <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                      {cat.items.map((item) => {
                        const connected = connections[item.id];
                        return (
                          <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[10px] font-bold text-ink-700">
                                {initials(item.name)}
                              </span>
                              <div>
                                <p className="text-sm font-medium text-ink-900">{item.name}</p>
                                <p className="text-xs text-ink-500">{item.detail}</p>
                              </div>
                            </div>
                            {connected ? (
                              <div className="flex items-center gap-2">
                                <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>
                                <button
                                  onClick={() => setConnections((c) => ({ ...c, [item.id]: false }))}
                                  className="text-xs font-medium text-ink-400 hover:text-[var(--accent-danger)]"
                                >
                                  Disconnect
                                </button>
                              </div>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => setConnections((c) => ({ ...c, [item.id]: true }))}>
                                Connect
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {tab === "addons" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI Add-ons</CardTitle>
                  <CardDescription>Extra AI agents beyond dispatch, all free, no per-feature charge.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="!pt-3 flex flex-col gap-5">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Included with your plan</p>
                  <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                    {includedAddons.map((addon) => (
                      <div key={addon.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
                        <div className="max-w-md">
                          <p className="text-sm font-medium text-ink-900">{addon.name}</p>
                          <p className="text-xs text-ink-500">{addon.tagline}</p>
                        </div>
                        <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Included</Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Partner referrals, free to you</p>
                  <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                    {commissionAddons.map((addon) => {
                      const enabled = settings.enabledAddons.includes(addon.id);
                      return (
                        <div key={addon.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
                          <div className="max-w-md">
                            <p className="text-sm font-medium text-ink-900">{addon.name}</p>
                            <p className="text-xs text-ink-500">{addon.tagline}</p>
                            {addon.commissionNote && <p className="mt-1 text-[11px] text-ink-400">{addon.commissionNote}</p>}
                          </div>
                          <Switch checked={enabled} onChange={() => toggleAddon(addon.id)} label={addon.name} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {tab === "billing" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Billing</CardTitle>
                  <CardDescription>
                    {carrier.plan} plan &middot; {formatCurrency(carrier.mrr)}/mo + 2% of booked freight. AI add-ons are free; Backroute earns from partner referrals instead.
                  </CardDescription>
                </CardHeader>
                <CardContent className="!pt-3 flex flex-col gap-5">
                  <div className="rounded-2xl border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-100 text-ink-600">
                          <CreditCard className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-ink-900">{card.brand} •••• {card.last4}</p>
                          <p className="text-xs text-ink-500">Expires {card.expiry} &middot; Next charge Oct 1</p>
                        </div>
                      </div>
                      {!editingCard && (
                        <Button variant="outline" size="sm" onClick={() => setEditingCard(true)}>Update payment method</Button>
                      )}
                    </div>
                    {editingCard && (
                      <div className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
                        <div className="flex flex-wrap gap-2.5">
                          <label className="flex flex-1 flex-col gap-1 text-xs text-ink-500">
                            Card number
                            <input
                              value={cardNumberInput}
                              onChange={(e) => setCardNumberInput(e.target.value.replace(/\D/g, "").slice(0, 16))}
                              placeholder="4242 4242 4242 4242"
                              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900 outline-none focus:border-ink-400"
                            />
                          </label>
                          <label className="flex w-28 flex-col gap-1 text-xs text-ink-500">
                            Expiry
                            <input
                              value={cardExpiryInput}
                              onChange={(e) => setCardExpiryInput(e.target.value)}
                              placeholder="MM/YY"
                              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900 outline-none focus:border-ink-400"
                            />
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={cardNumberInput.length < 4 || !cardExpiryInput.trim()}
                            onClick={() => {
                              setCard({ brand: "Visa", last4: cardNumberInput.slice(-4), expiry: cardExpiryInput.trim() });
                              setEditingCard(false);
                              setCardNumberInput("");
                              setCardExpiryInput("");
                            }}
                          >
                            Save card
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingCard(false)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Invoice history</p>
                    <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                      {INVOICES.map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                              <FileText className="h-4 w-4" />
                            </span>
                            <div>
                              <p className="text-sm font-medium text-ink-900">{formatDate(inv.date)}</p>
                              <p className="text-xs text-ink-500">{formatCurrency(inv.amount)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge tone="success">{inv.status}</Badge>
                            <button
                              onClick={() =>
                                downloadCsv(`invoice-${inv.date.slice(0, 10)}.csv`, ["Date", "Amount", "Status"], [[formatDate(inv.date), inv.amount, inv.status]])
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100"
                              aria-label="Download invoice"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {signedIn ? (
                <AppAccessCard />
              ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Team</CardTitle>
                  <CardDescription>Who can see loads, negotiations, and approve escalations.</CardDescription>
                </CardHeader>
                <CardContent className="!pt-3 flex flex-col gap-4">
                  <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                    {team.map((member) => (
                      <div key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={member.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink-900">{member.name}</p>
                            <p className="truncate text-xs text-ink-500">{member.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={member.role === "Owner" ? "dark" : "neutral"}>{member.role}</Badge>
                          {member.role !== "Owner" && (
                            <button
                              onClick={() => setTeam((t) => t.filter((m) => m.id !== member.id))}
                              aria-label={`Remove ${member.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-[var(--accent-danger)]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                      placeholder="teammate@company.com"
                      className="flex-1 rounded-full border border-line bg-ink-50/60 px-4 py-2 text-sm outline-none focus:border-ink-400"
                    />
                    <Button size="sm" onClick={handleInvite}>
                      <Plus className="h-3.5 w-3.5" /> Invite
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const words = name.replace(/\.(com|ai)$/i, "").split(/[\s.]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
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
