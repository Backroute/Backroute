"use client";

import Link from "next/link";
import { MessageCircle, MessageSquare, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Broker, Driver } from "@/lib/types";

const digits = (phone: string) => phone.replace(/[^\d+]/g, "");
const pill = "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-ink-100 px-3.5 py-1.5 text-xs font-semibold text-ink-900 hover:bg-ink-150";

/**
 * Reaching the people on a load in one tap, from wherever the load is open: call or text the driver (or write them in
 * the app), call the broker. Only what has a number shows.
 */
export function ContactRow({ driver, broker, className }: { driver?: Driver; broker?: Broker; className?: string }) {
  const first = driver?.name.split(" ")[0];
  if (!driver?.phone && !broker?.phone) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="group" aria-label="Contact">
      {driver?.phone && (
        <>
          <a href={`tel:${digits(driver.phone)}`} className={pill} aria-label={`Call ${driver.name}`}>
            <Phone className="h-3.5 w-3.5" /> Call {first}
          </a>
          <a href={`sms:${digits(driver.phone)}`} className={pill} aria-label={`Text ${driver.name}`}>
            <MessageSquare className="h-3.5 w-3.5" /> Text {first}
          </a>
          <Link href={`/carrier/messages?driver=${encodeURIComponent(driver.id)}`} className={pill} aria-label={`Message ${driver.name} in the app`}>
            <MessageCircle className="h-3.5 w-3.5" /> Message
          </Link>
        </>
      )}
      {broker?.phone && (
        <a href={`tel:${digits(broker.phone)}`} className={pill} aria-label={`Call ${broker.company}`}>
          <Phone className="h-3.5 w-3.5" /> Call {broker.company.split(/\s+/).slice(0, 2).join(" ")}
        </a>
      )}
    </div>
  );
}
