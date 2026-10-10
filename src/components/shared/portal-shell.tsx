"use client";

import { cloneElement, isValidElement, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { slideTypes } from "@/lib/nav-direction";
import { useEscapeKey } from "@/lib/hooks";
import { Logo } from "./logo";
import { LargeTitle } from "@/components/ui/large-title";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  /** How the badge reads on the phone tab bar: a filled red count when something is urgent, an orange ring when it's only waiting. */
  badgeTone?: "urgent" | "waiting";
  /** Other routes that belong to this section and light it up. */
  match?: string[];
}

/** Picks the most specific nav item matching the current path, so a portal root (e.g. /carrier) doesn't light up on every sub-route. */
function bestMatchHref(pathname: string | null, navItems: NavItem[]): string | undefined {
  if (!pathname) return undefined;
  let best: NavItem | undefined;
  let bestLen = -1;
  for (const item of navItems) {
    for (const href of [item.href, ...(item.match ?? [])]) {
      const matches = pathname === href || pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
      if (matches && href.length > bestLen) {
        best = item;
        bestLen = href.length;
      }
    }
  }
  return best?.href;
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
              aria-label="Close menu"
              className={cn("flex h-8 w-8 items-center justify-center rounded-full", dark ? "text-white/60 hover:bg-white/10" : "text-ink-500 hover:bg-ink-100")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className={cn("mt-0.5 px-1 text-xs", dark ? "text-white/40" : "text-ink-400")}>
          {portalLabel}
        </div>

        <nav className="mt-8 flex flex-col gap-0.5">
          {navItems.map((item) => {
            const current = bestMatchHref(pathname, navItems);
            const active = item.href === current;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                transitionTypes={slideTypes(navItems.map((n) => n.href), current, item.href)}
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
                      "rounded-full px-1.5 text-xs tabular",
                      active ? (dark ? "bg-ink-950/10 text-ink-950" : "bg-white/20 text-white") : "bg-ink-150 text-ink-700",
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
  bottomTabs,
  children,
}: {
  variant: "light" | "dark";
  /** Phones: the sections as a tab bar along the bottom, within thumb reach, like the driver app. */
  bottomTabs?: boolean;
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

  useEscapeKey(() => setMobileNavOpen(false), mobileNavOpen);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r px-5 py-6 lg:flex",
          dark ? "theme-ink border-white/10 bg-ink-950" : "border-line bg-white",
        )}
      >
        <SidebarContent dark={dark} portalLabel={portalLabel} navItems={navItems} switchTo={switchTo} footer={footer} pathname={pathname} />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className={cn(
              "relative flex h-full w-72 max-w-[80vw] flex-col justify-between px-5 py-6 shadow-2xl",
              dark ? "theme-ink bg-ink-950" : "bg-white",
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

      <main className={cn("min-w-0 flex-1 bg-ink-50/40", bottomTabs && "pb-24 lg:pb-0")}>
        {topBarWithMenu && <div className="sticky top-0 z-20">{topBarWithMenu}</div>}
        <PullToRefresh />
        {children}
      </main>

      {bottomTabs && <BottomTabs navItems={navItems} pathname={pathname} />}
    </div>
  );
}

function BottomTabs({ navItems, pathname }: { navItems: NavItem[]; pathname: string | null }) {
  const activeHref = bestMatchHref(pathname, navItems);
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 backdrop-blur-md lg:hidden"
    >
      {navItems.map((item) => {
        const active = item.href === activeHref;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            transitionTypes={slideTypes(navItems.map((n) => n.href), activeHref, item.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-xs font-medium transition-colors",
              active ? "text-ink-950" : "text-ink-500",
            )}
          >
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-ink-100")}>
              <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
            </span>
            {item.label}
            {typeof item.badge === "number" && item.badge > 0 && (
              <span
                className={cn(
                  "absolute right-[calc(50%-1.6rem)] top-0.5 min-w-4 rounded-full px-1 text-center text-xs font-semibold",
                  item.badgeTone === "waiting" ? "border-2 border-[var(--dot-warn)] bg-white leading-3 text-ink-950" : "bg-[var(--dot-danger)] leading-4 text-white",
                )}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
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
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-white px-4 py-6 sm:px-8">
      <div>
        <LargeTitle>{title}</LargeTitle>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </div>
  );
}
