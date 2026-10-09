"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, LogOut, Menu, Search, Settings } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useCompactTitle } from "@/lib/large-title";
import { useEscapeKey } from "@/lib/hooks";
import { openCommandPalette } from "./command-palette";
import { GroupedAlertFeed } from "./activity-feed";
import { OPEN_BELL_EVENT } from "./notification-toast";
import { Avatar } from "@/components/ui/avatar";
import { ThemePicker } from "./theme-picker";
import { cloudEnabled } from "@/lib/cloud/client";
import { exitDemo, inDemo } from "@/lib/cloud/demo";
import { signOut } from "@/lib/cloud/sync";
import type { ActivityEvent } from "@/lib/types";
import { ALERT_LABEL, alertKind } from "@/lib/alerts";

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}

export function TopBar({
  dark,
  notifications,
  accountName,
  accountSubtitle,
  settingsHref,
  exitHref,
  onMenuClick,
  alertsOnly,
  status,
  searchHint = "Search or jump to...",
}: {
  dark?: boolean;
  notifications: ActivityEvent[];
  /** The bell only carries the three alert kinds (needs you, money, safety); the rest stays in the AI log. */
  alertsOnly?: boolean;
  accountName: string;
  accountSubtitle: string;
  settingsHref?: string;
  exitHref: string;
  onMenuClick?: () => void;
  /** Shown left of the bell: the AI's status pill on the owner's dashboard. */
  status?: React.ReactNode;
  /** What the search box says before it's opened. */
  searchHint?: string;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useClickOutside(notifRef, () => setNotifOpen(false));
  useClickOutside(accountRef, () => setAccountOpen(false));
  useEscapeKey(() => setNotifOpen(false), notifOpen);
  useEscapeKey(() => setAccountOpen(false), accountOpen);
  useEffect(() => {
    const open = () => setNotifOpen(true);
    window.addEventListener(OPEN_BELL_EVENT, open);
    return () => window.removeEventListener(OPEN_BELL_EVENT, open);
  }, []);

  const compactTitle = useCompactTitle();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] transition-colors sm:gap-4 sm:px-8",
        // Frosted glass: the page shows through, blurred, as it scrolls underneath.
        dark ? "theme-ink border-white/10 bg-ink-950" : "border-line bg-white",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            aria-label="Open menu"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full lg:hidden",
              dark ? "text-white/60 hover:bg-white/10" : "text-ink-500 hover:bg-ink-100",
            )}
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={openCommandPalette}
          aria-label="Search"
          className={cn(
            "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
            // Once the page's name moves up here, the search shrinks to its icon on a phone to make room.
            compactTitle ? "w-auto shrink-0 sm:w-full sm:max-w-xs" : "w-full max-w-xs",
            dark ? "border-white/15 text-white/40 hover:border-white/30" : "border-line text-ink-400 hover:border-ink-300",
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden flex-1 text-left sm:inline">{searchHint}</span>
          <kbd className={cn("hidden rounded border px-1.5 py-0.5 text-xs sm:inline", dark ? "border-white/15 text-white/40" : "border-line text-ink-400")}>
            &#8984;K
          </kbd>
        </button>
        <AnimatePresence>
          {compactTitle && (
            <motion.span
              key={compactTitle}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              aria-hidden
              className={cn("min-w-0 truncate text-[15px] font-semibold", dark ? "text-white" : "text-ink-950")}
            >
              {compactTitle}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2">
        {status}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((o) => !o)}
            aria-label="Notifications"
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-full transition-colors",
              dark ? "text-white/60 hover:bg-white/10" : "text-ink-500 hover:bg-ink-100",
            )}
          >
            <Bell className="h-4 w-4" />
          </button>
          {notifOpen && (
            <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
              <div className="border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-ink-950">{alertsOnly ? "Alerts" : "Notifications"}</p>
                {alertsOnly && (
                  <p className="mt-0.5 text-xs text-ink-500">
                    {(["needs_you", "money", "safety"] as const).map((k) => `${notifications.filter((n) => alertKind(n) === k).length} ${ALERT_LABEL[k].toLowerCase()}`).join(" · ")}. Everything else is in Backroute log.
                  </p>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto px-4">
                <GroupedAlertFeed events={notifications.slice(0, 40)} />
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={accountRef}>
          <button onClick={() => setAccountOpen((o) => !o)} aria-label="Account menu" className="flex items-center gap-2 rounded-full p-0.5">
            <Avatar name={accountName} size="sm" />
          </button>
          {accountOpen && (
            <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
              <div className="border-b border-line px-4 py-3">
                <p className="truncate text-sm font-semibold text-ink-950">{accountName}</p>
                <p className="truncate text-xs text-ink-400">{accountSubtitle}</p>
              </div>
              <div className="border-b border-line px-3 py-2.5">
                <p className="mb-1.5 px-1 text-xs font-medium text-ink-500">Appearance</p>
                <ThemePicker compact />
              </div>
              <div className="flex flex-col p-1.5">
                {settingsHref && (
                  <Link href={settingsHref} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <Settings className="h-3.5 w-3.5" /> Settings
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    // A real account signs out (and the copy kept on this device is forgotten); the demo or the sample
                    // fleet just closes.
                    if (cloudEnabled && !inDemo()) void signOut();
                    else if (cloudEnabled) exitDemo(exitHref);
                    else window.location.assign(exitHref);
                  }}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                >
                  <LogOut className="h-3.5 w-3.5" /> Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
