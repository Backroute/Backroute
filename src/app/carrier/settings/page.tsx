"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CreditCard, Download, FileText, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { AppearanceCard } from "@/components/shared/appearance-card";
import { Help } from "@/components/ui/help";
import type { HelpKey } from "@/lib/help";
import { AppAccessCard } from "@/components/cloud/app-access";
import { DriverConsentsCard } from "@/components/cloud/driver-consents";
import { ChannelsCard } from "@/components/cloud/channels-card";
import { BusinessCard, DocumentsCard } from "@/components/cloud/business-card";
import { OwnerRulesCard } from "@/components/cloud/owner-rules";
import { PortalCard } from "@/components/cloud/portal-card";
import { BillingCard } from "@/components/cloud/billing-card";
import { PhoneAlerts } from "@/components/cloud/phone-alerts";
import { SettingsSearch } from "@/components/cloud/settings-search";
import { LeaveCard } from "@/components/cloud/leave-card";
import { IntegrationsHub } from "@/components/cloud/integrations-hub";
import { SecurityCard } from "@/components/cloud/security-card";
import { AuditLogCard } from "@/components/cloud/audit-log-card";
import { HistoryCard } from "@/components/cloud/history-card";
import { BasicsCard } from "@/components/cloud/basics-card";
import { formatCurrency, formatDate } from "@/lib/utils";

const TABS = [
  { key: "basics", label: "Basics" },
  { key: "general", label: "Company" },
  { key: "integrations", label: "Integrations" },
  { key: "addons", label: "Add-ons" },
  { key: "billing", label: "Billing & Team" },
  { key: "security", label: "Security" },
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

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
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
  // A real account opens on the five questions that matter; the demo, on everything.
  // A link can open a tab (?tab=general). The owner's own pick holds until a link asks for another one.
  const router = useRouter();
  const asked = useSearchParams().get("tab");
  const [picked, setPicked] = useState<{ asked: string | null; tab: TabKey } | null>(null);
  const tab: TabKey =
    picked && picked.asked === asked
      ? picked.tab
      : TABS.some((t) => t.key === asked) && (signedIn || asked !== "basics")
        ? (asked as TabKey)
        : signedIn
          ? "basics"
          : "general";
  const setTab = (next: TabKey) => setPicked({ asked, tab: next });
  const tabs = TABS.filter((t) => signedIn || t.key !== "basics").map((t) => (t.key === "general" && !signedIn ? { ...t, label: "General" } : t));
  const card = { brand: "Visa", last4: "4242", expiry: "08/29" };

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
        <div className="mb-4 max-w-md">
          <SettingsSearch
            signedIn={signedIn}
            onPick={(spot) => {
              // An integration opens its own panel in the hub.
              if (spot.open) return router.replace(`/carrier/settings?tab=integrations&open=${spot.open}`, { scroll: false });
              setTab(spot.tab as TabKey);
              // The tab renders first; then the card is brought into view and marked for a moment.
              setTimeout(() => {
                const el = document.getElementById(spot.id);
                if (!el) return;
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.classList.add("ring-2", "ring-[var(--link)]", "rounded-2xl");
                setTimeout(() => el.classList.remove("ring-2", "ring-[var(--link)]"), 1800);
              }, 60);
            }}
          />
        </div>
        <Tabs tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} active={tab} onChange={(k) => setTab(k as TabKey)} />

        <div className="mt-5 flex flex-col gap-6">
          {tab === "basics" && signedIn && (
            <div id="set-basics" className="scroll-mt-24">
              <BasicsCard />
            </div>
          )}
          {tab === "security" && (
            <>
              <div id="set-security" className="scroll-mt-24">
                <SecurityCard />
              </div>
              <div id="set-audit" className="scroll-mt-24">
                <AuditLogCard />
              </div>
            </>
          )}
          {tab === "general" && (
            <>
              <Card id="set-company" className="scroll-mt-24">
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

              <div id="set-channels" className="scroll-mt-24">{signedIn ? <ChannelsCard /> : <DispatchLineCard />}</div>

              {signedIn && (
                <>
                  <div id="set-business" className="scroll-mt-24"><BusinessCard /></div>
                  <div id="set-rules" className="scroll-mt-24"><OwnerRulesCard /></div>
                  <div id="set-portals" className="scroll-mt-24"><PortalCard /></div>
                  <div id="set-papers" className="scroll-mt-24"><DocumentsCard /></div>
                  <div id="set-history" className="scroll-mt-24"><HistoryCard /></div>
                </>
              )}

              <div id="set-language" className="scroll-mt-24"><OwnerLanguageCard /></div>
              <div id="set-appearance" className="scroll-mt-24"><AppearanceCard /></div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card id="set-autopilot" className="scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Autopilot</CardTitle>
                  </CardHeader>
                  <CardContent className="!pt-3 flex flex-col gap-4">
                    <AutopilotControl />
                    {!signedIn && (
                      <>
                    <ToggleRow label="Avoid low-reliability brokers" desc="Never source or negotiate with 'watch' tier brokers" checked={settings.avoidWatchBrokers} onChange={(v) => updateSettings({ avoidWatchBrokers: v })} />
                    <p className="pt-1 text-xs font-medium text-ink-800">How Backroute reaches brokers</p>
                    <ToggleRow label="Calls" desc="Calls brokers about loads, rates and detention" checked={settings.voiceEnabled} onChange={(v) => updateSettings({ voiceEnabled: v })} />
                    <ToggleRow label="Texts" desc="Texts brokers for rate checks and counters" checked={settings.smsEnabled} onChange={(v) => updateSettings({ smsEnabled: v })} />
                    <ToggleRow label="Email" desc="Reads and answers broker email" checked={settings.emailEnabled} onChange={(v) => updateSettings({ emailEnabled: v })} />
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card id="set-notifications" className="scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Notifications</CardTitle>
                  </CardHeader>
                  <CardContent className="!pt-3 flex flex-col gap-4">
                    <p className="text-xs text-ink-500">
                      Only three kinds of alerts reach you: something that needs you, money moving, and safety. Everything else Backroute does stays in its log.
                    </p>
                    {signedIn && <PhoneAlerts />}
                    <ToggleRow help="notifySms" label="Text me when something needs me" desc="Approvals, loads to pick, drivers' requests" checked={settings.notifySms} onChange={(v) => updateSettings({ notifySms: v })} />
                    <ToggleRow help="notifyEmail" label="Email me a copy of every alert" desc="Needs you, money and safety" checked={settings.notifyEmail} onChange={(v) => updateSettings({ notifyEmail: v })} />
                    <ToggleRow help="dailyText" label="End-of-day text at 6 PM" desc="Loads delivered, profit, and anything that needs you tomorrow" checked={settings.dailyText} onChange={(v) => updateSettings({ dailyText: v })} />
                    {settings.dailyText && <DailyTextPreview />}
                    {signedIn && (
                      <>
                        <ToggleRow help="weeklyReview" label="Your week, Monday morning" desc="What the trucks made, empty miles, best and worst broker, and one thing to change" checked={settings.weeklyReview !== false} onChange={(v) => updateSettings({ weeklyReview: v })} />
                        <ToggleRow help="morningBriefs" label="Drivers' morning text" desc="Each driver's stops, times, dock tips and weather before they roll (drivers can turn theirs off)" checked={settings.morningBriefs !== false} onChange={(v) => updateSettings({ morningBriefs: v })} />
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {tab === "integrations" && <IntegrationsHub />}

          {tab === "addons" && (
            <Card id="set-addons" className="scroll-mt-24">
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Add-ons</CardTitle>
                  <CardDescription>Extra helpers beyond dispatch, all free, no per-feature charge.</CardDescription>
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
                            {addon.commissionNote && <p className="mt-1 text-xs text-ink-400">{addon.commissionNote}</p>}
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
              {signedIn ? (
                <>
                  <div id="set-billing" className="scroll-mt-24"><BillingCard /></div>
                  <div id="set-data" className="scroll-mt-24"><LeaveCard /></div>
                </>
              ) : (
              <Card id="set-billing" className="scroll-mt-24">
                <CardHeader>
                  <CardTitle>Billing</CardTitle>
                  <CardDescription>
                    {carrier.plan} plan &middot; {formatCurrency(carrier.mrr)}/mo + 2% of booked freight. Add-ons are free; Backroute earns from partner referrals instead.
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
                      <Badge tone="neutral">Sample</Badge>
                    </div>
                    {/* The practice account never asks for a card: a real account updates it on the payment company's own secure page. */}
                    <p className="mt-3 text-xs text-ink-500">
                      A sample card. In your own account, you change it on the secure payment page from Billing; Backroute never asks you to type a card number here.
                    </p>
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
              )}

              {signedIn ? (
                <div id="set-team" className="scroll-mt-24 flex flex-col gap-6">
                  <AppAccessCard />
                  <DriverConsentsCard />
                </div>
              ) : (
              <Card id="set-team" className="scroll-mt-24">
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink-950">{value}</p>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange, help }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; help?: HelpKey }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="flex items-center gap-1 text-sm font-medium text-ink-900">
          {label}
          {help && <Help topic={help} />}
        </p>
        <p className="text-xs text-ink-500">{desc}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
