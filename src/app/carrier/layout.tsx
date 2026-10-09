"use client";

import { useEffect } from "react";
import { CloudGate } from "@/components/cloud/cloud-gate";
import { CarrierSwitcher } from "@/components/cloud/carrier-switcher";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Monitor, Moon, Pause, Play, Settings, Sun, Truck, Users, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { setTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { slideTypes } from "@/lib/nav-direction";
import { isAlert, isUrgent } from "@/lib/alerts";
import { PortalShell, type NavItem } from "@/components/shared/portal-shell";
import { TopBar } from "@/components/shared/top-bar";
import { AiStatus } from "@/components/shared/ai-status";
import { SampleTracker } from "@/components/cloud/sample-fleet";
import { useNeedsYou } from "@/components/shared/needs-you";
import { useAppBadge } from "@/lib/app-badge";
import { CommandPalette, type CommandGroup } from "@/components/shared/command-palette";
import { NotificationToastHost } from "@/components/shared/notification-toast";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads } from "@/lib/selectors";
import { InstallPrompt } from "@/components/shared/install-prompt";

/** Five sections instead of eleven pages; each section's pages sit on tabs inside it. */
const SECTIONS: { nav: NavItem; tabs: { href: string; label: string }[] }[] = [
  { nav: { href: "/carrier", label: "Home", icon: LayoutGrid }, tabs: [{ href: "/carrier", label: "Today" }, { href: "/carrier/messages", label: "Messages" }] },
  { nav: { href: "/carrier/loads", label: "Loads", icon: Truck }, tabs: [{ href: "/carrier/loads", label: "All loads" }, { href: "/carrier/negotiations", label: "Negotiating" }, { href: "/carrier/customers", label: "Customers" }] },
  {
    nav: { href: "/carrier/fleet", label: "Fleet", icon: Users },
    tabs: [{ href: "/carrier/fleet", label: "Drivers & trucks" }, { href: "/carrier/maintenance", label: "Maintenance" }, { href: "/carrier/compliance", label: "Compliance" }],
  },
  {
    nav: { href: "/carrier/earnings", label: "Money", icon: Wallet },
    tabs: [
      { href: "/carrier/earnings", label: "Earnings" },
      { href: "/carrier/settlements", label: "Getting paid" },
      { href: "/carrier/pay", label: "Driver pay" },
      { href: "/carrier/costs", label: "Fuel & tolls" },
      { href: "/carrier/lanes", label: "Lanes" },
      { href: "/carrier/brokers", label: "Brokers" },
    ],
  },
  { nav: { href: "/carrier/settings", label: "Settings", icon: Settings }, tabs: [] },
];
const NAV: NavItem[] = SECTIONS.map((sec) => ({ ...sec.nav, match: sec.tabs.map((t) => t.href).filter((h) => h !== sec.nav.href) }));
const BOOKS_NAV = new Set(["/carrier/fleet", "/carrier/earnings", "/carrier/settings"]);
const BOOKS_PAGES = SECTIONS.filter((sec) => BOOKS_NAV.has(sec.nav.href)).flatMap((sec) => (sec.tabs.length ? sec.tabs.map((t) => t.href) : [sec.nav.href]));
const ALL_PAGES = SECTIONS.flatMap((sec) => (sec.tabs.length ? sec.tabs : [{ href: sec.nav.href, label: sec.nav.label }]).map((t) => ({ ...t, icon: sec.nav.icon })));

/** The tabs of whichever section the current page belongs to. */
function SectionTabs() {
  const pathname = usePathname();
  const section = SECTIONS.find((sec) => sec.tabs.some((t) => pathname === t.href || (t.href !== "/carrier" && pathname.startsWith(`${t.href}/`))));
  if (!section || section.tabs.length < 2) return null;
  const currentTab = section.tabs.find((t) => pathname === t.href || (t.href !== "/carrier" && pathname.startsWith(`${t.href}/`)));
  return (
    <nav aria-label={`${section.nav.label} sections`} className="flex gap-1 overflow-x-auto border-b border-line px-4 pt-3 no-scrollbar sm:px-8">
      {section.tabs.map((t) => {
        const active = pathname === t.href || (t.href !== "/carrier" && pathname.startsWith(`${t.href}/`));
        return (
          <Link
            key={t.href}
            href={t.href}
            transitionTypes={slideTypes(section.tabs.map((x) => x.href), currentTab?.href, t.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
              active ? "border-ink-950 text-ink-950" : "border-transparent text-ink-500 hover:text-ink-950",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function CarrierLayout({ children }: { children: React.ReactNode }) {
  return (
    <CloudGate area="carrier">
      <CarrierShell>{children}</CarrierShell>
    </CloudGate>
  );
}

function CarrierShell({ children }: { children: React.ReactNode }) {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useStore((s) => s.trucks);
  const drivers = useStore((s) => s.drivers);
  const activity = useStore((s) => s.activity).filter((e) => e.carrierId === carrier.id);
  // Only three kinds of things interrupt the owner: needs you, money, safety.
  const alerts = activity.filter(isAlert);
  const needsYou = useNeedsYou().count;
  const router = useRouter();
  // The number on the app's icon (home screen, dock): what's waiting for the owner.
  useAppBadge(needsYou);
  // A bookkeeper keeps the books: Money, the fleet's papers, and Settings. Dispatching isn't theirs.
  const books = useStore((s) => s.session.mode === "books");
  const pathname = usePathname();
  useEffect(() => {
    if (books && !BOOKS_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) router.replace("/carrier/earnings");
  }, [books, pathname, router]);
  // One number in the whole app: what needs the owner, on Home. Loads, the bell and the status pill don't repeat it.
  const navWithBadge = NAV.filter((n) => !books || BOOKS_NAV.has(n.href)).map((n) => (n.href === "/carrier" ? { ...n, badge: needsYou } : n));

  const paused = useStore((s) => !!s.settings.paused);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const sendCarrierMessage = useStore((s) => s.actions.sendCarrierMessage);
  const commandGroups: CommandGroup[] = [
    {
      heading: "Do",
      items: [
        paused
          ? { id: "resume", label: "Resume Backroute", icon: Play, keywords: "start unpause continue", run: () => updateSettings({ paused: false, pausedAt: undefined }) }
          : { id: "pause", label: "Pause Backroute", sublabel: "emergency stop", icon: Pause, keywords: "stop halt freeze emergency", run: () => updateSettings({ paused: true, pausedAt: new Date().toISOString() }) },
        { id: "theme-dark", label: "Dark mode", icon: Moon, keywords: "night theme appearance", run: () => setTheme("dark") },
        { id: "theme-light", label: "Light mode", icon: Sun, keywords: "day theme appearance", run: () => setTheme("light") },
        { id: "theme-auto", label: "Match my phone's light or dark", icon: Monitor, keywords: "auto system theme appearance", run: () => setTheme("system") },
      ],
    },
    { heading: "Go to", items: ALL_PAGES.map((n) => ({ id: n.href, label: n.label, icon: n.icon, href: n.href })) },
    {
      heading: "Loads",
      items: loads.slice(0, 30).map((l) => ({
        id: l.id,
        label: `${l.lane.origin} → ${l.lane.destination}`,
        sublabel: l.referenceNumber,
        href: `/carrier/loads/${l.id}`,
      })),
    },
    {
      heading: "Fleet",
      items: [
        ...trucks.map((t) => ({ id: t.id, label: t.unitNumber, sublabel: `${t.currentCity}, ${t.currentState}`, href: "/carrier/fleet" })),
        ...drivers.map((d) => ({ id: d.id, label: d.name, sublabel: d.homeBase, href: "/carrier/fleet" })),
      ],
    },
  ];

  return (
    <PortalShell
      variant="light"
      bottomTabs
      portalLabel="Owner"
      navItems={navWithBadge}
      switchTo={{ href: "/", label: "Back to home" }}
      topBar={
        <TopBar
          notifications={alerts}
          alertsOnly
          accountName={carrier.name}
          accountSubtitle={carrier.mc}
          settingsHref="/carrier/settings"
          exitHref="/"
          status={<AiStatus needsYou={needsYou} />}
          searchHint="Search or ask…"
        />
      }
      footer={
        <>
        <CarrierSwitcher />
        <div className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
          <Avatar name={carrier.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-ink-950">{carrier.name}</p>
            <p className="truncate text-xs text-ink-400">{carrier.mc}</p>
          </div>
          <Badge tone="dark">{carrier.plan}</Badge>
        </div>
        </>
      }
    >
      <CommandPalette
        groups={commandGroups}
        onAsk={(text) => {
          // An order or question: it goes to the AI dispatcher's thread, where the answer (or what it did) shows up.
          sendCarrierMessage(carrier.id, text);
          router.push("/carrier/messages");
        }}
      />
      <InstallPrompt />
      <SampleTracker />
      <SectionTabs />
      {children}
      <NotificationToastHost events={alerts.filter(isUrgent)} hrefFor={(e) => (e.loadId ? `/carrier/loads/${e.loadId}` : undefined)} />
    </PortalShell>
  );
}
