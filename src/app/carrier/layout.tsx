"use client";

import { BarChart3, LayoutGrid, MessageSquareText, Settings, Truck } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/shared/portal-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { usePrimaryCarrier, useCarrierEscalations } from "@/lib/selectors";

const NAV: NavItem[] = [
  { href: "/carrier", label: "Overview", icon: LayoutGrid },
  { href: "/carrier/loads", label: "Loads", icon: Truck },
  { href: "/carrier/negotiations", label: "Negotiations", icon: MessageSquareText },
  { href: "/carrier/fleet", label: "Fleet", icon: Truck },
  { href: "/carrier/earnings", label: "Earnings", icon: BarChart3 },
  { href: "/carrier/settings", label: "Settings", icon: Settings },
];

export default function CarrierLayout({ children }: { children: React.ReactNode }) {
  const carrier = usePrimaryCarrier();
  const escalations = useCarrierEscalations().filter((e) => e.status === "open");
  const navWithBadge = NAV.map((n) => (n.href === "/carrier/negotiations" ? { ...n, badge: escalations.length } : n));

  return (
    <PortalShell
      variant="light"
      portalLabel="Carrier Dashboard"
      navItems={navWithBadge}
      switchTo={{ href: "/", label: "Switch portal" }}
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
      {children}
    </PortalShell>
  );
}
