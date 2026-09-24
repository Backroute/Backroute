"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Settings, Truck, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAlert } from "@/lib/alerts";
import { PortalShell, type NavItem } from "@/components/shared/portal-shell";
import { TopBar } from "@/components/shared/top-bar";
import { CommandPalette, type CommandGroup } from "@/components/shared/command-palette";
import { NotificationToastHost } from "@/components/shared/notification-toast";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads } from "@/lib/selectors";

/** Five sections instead of eleven pages; each section's pages sit on tabs inside it. */
const SECTIONS: { nav: NavItem; tabs: { href: string; label: string }[] }[] = [
  { nav: { href: "/carrier", label: "Home", icon: LayoutGrid }, tabs: [{ href: "/carrier", label: "Today" }, { href: "/carrier/messages", label: "Ask the AI" }] },
  { nav: { href: "/carrier/loads", label: "Loads", icon: Truck }, tabs: [{ href: "/carrier/loads", label: "All loads" }, { href: "/carrier/negotiations", label: "Negotiating" }] },
  {
    nav: { href: "/carrier/fleet", label: "Fleet", icon: Users },
    tabs: [{ href: "/carrier/fleet", label: "Drivers & trucks" }, { href: "/carrier/maintenance", label: "Maintenance" }, { href: "/carrier/compliance", label: "Compliance" }],
  },
  {
    nav: { href: "/carrier/earnings", label: "Money", icon: Wallet },
    tabs: [{ href: "/carrier/earnings", label: "Earnings" }, { href: "/carrier/settlements", label: "Getting paid" }, { href: "/carrier/brokers", label: "Brokers" }],
  },
  { nav: { href: "/carrier/settings", label: "Settings", icon: Settings }, tabs: [] },
];
const NAV: NavItem[] = SECTIONS.map((sec) => ({ ...sec.nav, match: sec.tabs.map((t) => t.href).filter((h) => h !== sec.nav.href) }));
const ALL_PAGES = SECTIONS.flatMap((sec) => (sec.tabs.length ? sec.tabs : [{ href: sec.nav.href, label: sec.nav.label }]).map((t) => ({ ...t, icon: sec.nav.icon })));

/** The tabs of whichever section the current page belongs to. */
function SectionTabs() {
  const pathname = usePathname();
  const section = SECTIONS.find((sec) => sec.tabs.some((t) => pathname === t.href || (t.href !== "/carrier" && pathname.startsWith(`${t.href}/`))));
  if (!section || section.tabs.length < 2) return null;
  return (
    <nav aria-label={`${section.nav.label} sections`} className="flex gap-1 overflow-x-auto border-b border-line px-4 pt-3 no-scrollbar sm:px-8">
      {section.tabs.map((t) => {
        const active = pathname === t.href || (t.href !== "/carrier" && pathname.startsWith(`${t.href}/`));
        return (
          <Link
            key={t.href}
            href={t.href}
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
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useStore((s) => s.trucks);
  const drivers = useStore((s) => s.drivers);
  const activity = useStore((s) => s.activity).filter((e) => e.carrierId === carrier.id);
  // Only three kinds of things interrupt the owner: needs you, money, safety.
  const alerts = activity.filter(isAlert);
  const pendingOffers = loads.filter((l) => l.stage === "offered").length;
  // Matches exactly what the Negotiations page itself lists, so the badge never disagrees with the page it labels.
  const activeNegotiations = loads.filter((l) => l.stage === "negotiating" || l.stage === "rate_confirmed").length;
  const navWithBadge = NAV.map((n) => (n.href === "/carrier/loads" ? { ...n, badge: pendingOffers + activeNegotiations } : n));

  const commandGroups: CommandGroup[] = [
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
      portalLabel="Carrier Dashboard"
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
        />
      }
      footer={
        <div className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
          <Avatar name={carrier.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-ink-950">{carrier.name}</p>
            <p className="truncate text-[11px] text-ink-400">{carrier.mc}</p>
          </div>
          <Badge tone="dark">{carrier.plan}</Badge>
        </div>
      }
    >
      <CommandPalette groups={commandGroups} />
      <SectionTabs />
      {children}
      <NotificationToastHost events={alerts} hrefFor={(e) => (e.loadId ? `/carrier/loads/${e.loadId}` : undefined)} />
    </PortalShell>
  );
}
