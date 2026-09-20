"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, LogOut, Menu, Search, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEscapeKey, useNow } from "@/lib/hooks";
import { openCommandPalette } from "./command-palette";
import { ActivityFeed } from "./activity-feed";
import { Avatar } from "@/components/ui/avatar";
import type { ActivityEvent } from "@/lib/types";

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
}: {
  dark?: boolean;
  notifications: ActivityEvent[];
  accountName: string;
  accountSubtitle: string;
  settingsHref?: string;
  exitHref: string;
  onMenuClick?: () => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useClickOutside(notifRef, () => setNotifOpen(false));
  useClickOutside(accountRef, () => setAccountOpen(false));
  useEscapeKey(() => setNotifOpen(false), notifOpen);
  useEscapeKey(() => setAccountOpen(false), accountOpen);

  const now = useNow();
  const recentCount = now === null ? 0 : notifications.filter((n) => now - new Date(n.timestamp).getTime() < 120_000).length;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b px-4 py-3 sm:gap-4 sm:px-8",
        dark ? "border-white/10 bg-ink-950" : "border-line bg-white",
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
            "flex w-full max-w-xs items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
            dark ? "border-white/15 text-white/40 hover:border-white/30" : "border-line text-ink-400 hover:border-ink-300",
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden flex-1 text-left sm:inline">Search or jump to...</span>
          <kbd className={cn("hidden rounded border px-1.5 py-0.5 text-[10px] sm:inline", dark ? "border-white/15 text-white/40" : "border-line text-ink-400")}>
            &#8984;K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-2">
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
            {recentCount > 0 && (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--accent-live)]" />
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
              <div className="border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-ink-950">Notifications</p>
              </div>
              <div className="max-h-96 overflow-y-auto px-4">
                <ActivityFeed events={notifications.slice(0, 8)} dense />
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={accountRef}>
          <button onClick={() => setAccountOpen((o) => !o)} aria-label="Account menu" className="flex items-center gap-2 rounded-full p-0.5">
            <Avatar name={accountName} size="sm" />
          </button>
          {accountOpen && (
            <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
              <div className="border-b border-line px-4 py-3">
                <p className="truncate text-sm font-semibold text-ink-950">{accountName}</p>
                <p className="truncate text-xs text-ink-400">{accountSubtitle}</p>
              </div>
              <div className="flex flex-col p-1.5">
                {settingsHref && (
                  <Link href={settingsHref} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <Settings className="h-3.5 w-3.5" /> Settings
                  </Link>
                )}
                <Link href={exitHref} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                  <LogOut className="h-3.5 w-3.5" /> Log out
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
