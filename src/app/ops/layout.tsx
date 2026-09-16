"use client";

import { BarChart3, Building2, LayoutGrid, Lock, Radio, ShieldAlert, Truck, Users } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/shared/portal-shell";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { PRIMARY_CARRIER_ID } from "@/lib/mock-data";

const NAV: NavItem[] = [
  { href: "/ops", label: "Overview", icon: LayoutGrid },
  { href: "/ops/carriers", label: "Carriers", icon: Building2 },
  { href: "/ops/agents", label: "Agent Fleet", icon: Radio },
  { href: "/ops/loads", label: "Loads", icon: Truck },
  { href: "/ops/brokers", label: "Brokers", icon: Users },
  { href: "/ops/escalations", label: "Escalations", icon: ShieldAlert },
  { href: "/ops/revenue", label: "Revenue", icon: BarChart3 },
];

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const escalations = useStore((s) => s.escalations);
  const openCount = escalations.filter((e) => e.status === "open" && e.carrierId === PRIMARY_CARRIER_ID).length;
  const navWithBadge = NAV.map((n) => (n.href === "/ops/escalations" ? { ...n, badge: openCount } : n));

  return (
    <PortalShell
      variant="dark"
      portalLabel="Mission Control"
      navItems={navWithBadge}
      switchTo={{ href: "/", label: "Exit to public site" }}
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/40">
            <Lock className="h-3 w-3" />
            Internal only — not part of the customer product
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-white/15 px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[11px] font-bold text-ink-950">HD</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">Harvey Dhillon</p>
              <p className="truncate text-[11px] text-white/40">Founder & CEO</p>
            </div>
            <Badge tone="dark" className="!bg-white/10 !text-white">Admin</Badge>
          </div>
        </div>
      }
    >
      {children}
    </PortalShell>
  );
}
