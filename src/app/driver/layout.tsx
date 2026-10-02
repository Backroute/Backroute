"use client";

import { CloudGate } from "@/components/cloud/cloud-gate";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, Truck, User, Wallet } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { slideTypes } from "@/lib/nav-direction";
import { useCompactTitle } from "@/lib/large-title";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { LiveTripPill } from "@/components/shared/live-trip-pill";
import { HosClock } from "@/components/driver/hos-clock";
import { Logo } from "@/components/shared/logo";
import { Avatar } from "@/components/ui/avatar";
import { NotificationToastHost } from "@/components/shared/notification-toast";
import { IncomingCallHost } from "@/components/shared/dispatch-call-screen";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, truckActiveLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { isAlert } from "@/lib/alerts";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { InstallPrompt } from "@/components/shared/install-prompt";

/** No standalone Docs tab — documents live on each load's own detail page (current or past), opened from
 *  the Loads tab, so there's one place per load instead of a second list that has to agree with it. */
const TABS = [
  { href: "/driver", key: "home", icon: Home },
  { href: "/driver/loads", key: "loads", icon: Truck },
  { href: "/driver/earnings", key: "earnings", icon: Wallet },
  { href: "/driver/messages", key: "messages", icon: MessageCircle },
  { href: "/driver/profile", key: "profile", icon: User },
] as const;

const TAB_ORDER = TABS.map((t) => t.href as string);

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <CloudGate area="driver">
      <DriverShell>{children}</DriverShell>
    </CloudGate>
  );
}

function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const compactTitle = useCompactTitle();
  // The tab this page sits under (a load's page sits under Loads), so the slide goes the right way.
  const currentTab = [...TAB_ORDER].reverse().find((h) => pathname === h || pathname.startsWith(`${h}/`));
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
        {/* Frosted and pinned: the page scrolls under it, and its name moves up here once the big title is gone. */}
        <div className="sticky top-0 z-30 flex items-center justify-between bg-white/75 px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur-xl backdrop-saturate-150 sm:rounded-t-[2.5rem]">
          <AnimatePresence mode="wait" initial={false}>
            {compactTitle ? (
              <motion.span key="title" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="truncate text-[17px] font-semibold text-ink-950">
                {compactTitle}
              </motion.span>
            ) : (
              <motion.span key="logo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                <Logo className="text-lg" />
              </motion.span>
            )}
          </AnimatePresence>
          <span className="flex items-center gap-2">
            <HosClock driver={driver} />
            <Link href="/driver/profile" aria-label="Your profile">
              <Avatar name={driver.name} size="sm" />
            </Link>
          </span>
        </div>
        <PullToRefresh />
        {/* On a trip, away from Home (whose map already shows it): the trip stays in view at the top. */}
        {current && pathname !== "/driver" && <LiveTripPill load={current} href="/driver" />}

        <div className="flex-1 pb-20">{children}</div>

        <nav className="sticky bottom-0 z-30 flex items-center justify-between gap-1 border-t border-line bg-white/80 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl backdrop-saturate-150 sm:rounded-b-[2.5rem]">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                transitionTypes={slideTypes(TAB_ORDER, currentTab, tab.href)}
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
      <InstallPrompt />
      <IncomingCallHost driverId={driver.id} />
      <NotificationToastHost events={driverActivity} hrefFor={(e) => (e.loadId ? `/driver/loads/${e.loadId}` : undefined)} />
    </div>
  );
}
