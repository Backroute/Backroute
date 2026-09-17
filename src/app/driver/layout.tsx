"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Home, MessageCircle, Truck, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { Avatar } from "@/components/ui/avatar";
import { usePrimaryDriver } from "@/lib/selectors";

const TABS = [
  { href: "/driver", label: "Home", icon: Home },
  { href: "/driver/loads", label: "Loads", icon: Truck },
  { href: "/driver/messages", label: "Messages", icon: MessageCircle },
  { href: "/driver/documents", label: "Docs", icon: FileText },
  { href: "/driver/profile", label: "Profile", icon: User },
];

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const driver = usePrimaryDriver();

  return (
    <div className="flex min-h-screen justify-center bg-ink-100">
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
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
