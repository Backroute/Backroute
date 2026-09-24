"use client";

import { CloudGate } from "@/components/cloud/cloud-gate";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, Truck, User, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { Avatar } from "@/components/ui/avatar";
import { NotificationToastHost } from "@/components/shared/notification-toast";
import { IncomingCallHost } from "@/components/shared/dispatch-call-screen";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, truckActiveLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { isAlert } from "@/lib/alerts";
import { useDriverUi } from "@/lib/lang/use-driver-ui";

/** No standalone Docs tab — documents live on each load's own detail page (current or past), opened from
 *  the Loads tab, so there's one place per load instead of a second list that has to agree with it. */
const TABS = [
  { href: "/driver", key: "home", icon: Home },
  { href: "/driver/loads", key: "loads", icon: Truck },
  { href: "/driver/earnings", key: "earnings", icon: Wallet },
  { href: "/driver/messages", key: "messages", icon: MessageCircle },
  { href: "/driver/profile", key: "profile", icon: User },
] as const;

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <CloudGate area="driver">
      <DriverShell>{children}</DriverShell>
    </CloudGate>
  );
}

function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t, lang } = useDriverUi();
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const activity = useStore((s) => s.activity);
  const truck = trucks.find((t) => t.id === driver.truckId);
  const { current, next } = truckActiveLoads(loads, truck);
  const relevantLoadIds = new Set([current?.id, next?.id].filter(Boolean));
  const driverActivity = activity.filter((e) => e.loadId && relevantLoadIds.has(e.loadId) && isAlert(e));

  return (
    <div lang={lang} className="flex min-h-screen justify-center bg-ink-100">
      <div className="flex w-full max-w-md flex-col bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.04)] sm:my-6 sm:min-h-[calc(100vh-3rem)] sm:rounded-[2.5rem] sm:border sm:border-line">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <Logo className="text-lg" />
          <Link href="/driver/profile">
            <Avatar name={driver.name} size="sm" />
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto pb-20">{children}</div>

        <nav className="sticky bottom-0 flex items-center justify-between gap-1 border-t border-line bg-white/95 px-3 py-2 backdrop-blur-sm sm:rounded-b-[2.5rem]">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-[10px] font-medium transition-colors",
                  active ? "bg-ink-950 text-white" : "text-ink-400 hover:text-ink-700",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                {t.tabs[tab.key]}
              </Link>
            );
          })}
        </nav>
      </div>
      <IncomingCallHost driverId={driver.id} />
      <NotificationToastHost events={driverActivity} hrefFor={(e) => (e.loadId ? `/driver/loads/${e.loadId}` : undefined)} />
    </div>
  );
}
