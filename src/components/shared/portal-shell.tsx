"use client";

import { cloneElement, isValidElement, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

function SidebarContent({
  dark,
  portalLabel,
  navItems,
  switchTo,
  footer,
  pathname,
  onNavigate,
  onClose,
}: {
  dark: boolean;
  portalLabel: string;
  navItems: NavItem[];
  switchTo?: { href: string; label: string };
  footer?: React.ReactNode;
  pathname: string | null;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between px-1">
          <Logo dark={dark} />
          {onClose && (
            <button
              onClick={onClose}
              className={cn("flex h-8 w-8 items-center justify-center rounded-full", dark ? "text-white/60 hover:bg-white/10" : "text-ink-500 hover:bg-ink-100")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className={cn("mt-1 px-1 text-[11px] font-medium uppercase tracking-wider", dark ? "text-white/40" : "text-ink-400")}>
          {portalLabel}
        </div>

        <nav className="mt-8 flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? dark
                      ? "bg-white text-ink-950"
                      : "bg-ink-950 text-white"
                    : dark
                      ? "text-white/60 hover:bg-white/10 hover:text-white"
                      : "text-ink-600 hover:bg-ink-100 hover:text-ink-950",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4" strokeWidth={2} />
                  {item.label}
                </span>
                {typeof item.badge === "number" && item.badge > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] tabular",
                      active ? (dark ? "bg-ink-950/10 text-ink-950" : "bg-white/20 text-white") : "bg-[var(--accent-warn)]/15 text-[var(--accent-warn)]",
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-3">
        {switchTo && (
          <Link
            href={switchTo.href}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors",
              dark ? "border-white/15 text-white/70 hover:bg-white/10" : "border-line text-ink-600 hover:bg-ink-100",
            )}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {switchTo.label}
          </Link>
        )}
        {footer}
      </div>
    </>
  );
}

export function PortalShell({
  variant,
  portalLabel,
  navItems,
  switchTo,
  footer,
  topBar,
  children,
}: {
  variant: "light" | "dark";
  portalLabel: string;
  navItems: NavItem[];
  switchTo?: { href: string; label: string };
  footer?: React.ReactNode;
  topBar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const dark = variant === "dark";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const topBarWithMenu = topBar && isValidElement<{ onMenuClick?: () => void }>(topBar)
    ? cloneElement(topBar, { onMenuClick: () => setMobileNavOpen(true) })
    : topBar;

  return (
    <div className="flex min-h-screen w-full bg-white">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r px-5 py-6 lg:flex",
          dark ? "border-white/10 bg-ink-950" : "border-line bg-white",
        )}
      >
        <SidebarContent dark={dark} portalLabel={portalLabel} navItems={navItems} switchTo={switchTo} footer={footer} pathname={pathname} />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div
            className={cn(
              "relative flex h-full w-72 max-w-[80vw] flex-col justify-between px-5 py-6 shadow-2xl",
              dark ? "bg-ink-950" : "bg-white",
            )}
          >
            <SidebarContent
              dark={dark}
              portalLabel={portalLabel}
              navItems={navItems}
              switchTo={switchTo}
              footer={footer}
              pathname={pathname}
              onNavigate={() => setMobileNavOpen(false)}
              onClose={() => setMobileNavOpen(false)}
            />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 bg-ink-50/40">
        {topBarWithMenu && <div className="sticky top-0 z-20">{topBarWithMenu}</div>}
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-white/70 px-4 py-6 sm:px-8 backdrop-blur-sm">
      <div>
        <h1 className="font-display text-2xl text-ink-950">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </div>
  );
}
