"use client";

import { BarChart3, LayoutGrid, MessageCircle, MessageSquareText, Receipt, Settings, ShieldCheck, Truck, Wrench } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/shared/portal-shell";
import { TopBar } from "@/components/shared/top-bar";
import { CommandPalette, type CommandGroup } from "@/components/shared/command-palette";
import { NotificationToastHost } from "@/components/shared/notification-toast";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads } from "@/lib/selectors";

const NAV: NavItem[] = [
  { href: "/carrier", label: "Overview", icon: LayoutGrid },
  { href: "/carrier/messages", label: "Messages", icon: MessageCircle },
  { href: "/carrier/loads", label: "Loads", icon: Truck },
  { href: "/carrier/negotiations", label: "Negotiations", icon: MessageSquareText },
  { href: "/carrier/fleet", label: "Fleet", icon: Truck },
  { href: "/carrier/earnings", label: "Earnings", icon: BarChart3 },
  { href: "/carrier/settlements", label: "Settlements", icon: Receipt },
  { href: "/carrier/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/carrier/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/carrier/settings", label: "Settings", icon: Settings },
];

export default function CarrierLayout({ children }: { children: React.ReactNode }) {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useStore((s) => s.trucks);
  const drivers = useStore((s) => s.drivers);
  const activity = useStore((s) => s.activity).filter((e) => e.carrierId === carrier.id);
  const pendingOffers = loads.filter((l) => l.stage === "offered").length;
  // Matches exactly what the Negotiations page itself lists, so the badge never disagrees with the page it labels.
  const activeNegotiations = loads.filter((l) => l.stage === "negotiating" || l.stage === "rate_confirmed").length;
  const navWithBadge = NAV.map((n) => {
    if (n.href === "/carrier/negotiations") return { ...n, badge: activeNegotiations };
    if (n.href === "/carrier/loads") return { ...n, badge: pendingOffers };
    return n;
  });

  const commandGroups: CommandGroup[] = [
    { heading: "Go to", items: NAV.map((n) => ({ id: n.href, label: n.label, icon: n.icon, href: n.href })) },
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
          notifications={activity}
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
      {children}
      <NotificationToastHost events={activity} hrefFor={(e) => (e.loadId ? `/carrier/loads/${e.loadId}` : undefined)} />
    </PortalShell>
  );
}
