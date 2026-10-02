"use client";

import {
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  Database,
  FileText,
  Flag,
  LifeBuoy,
  Link2,
  ListChecks,
  Mail,
  MapPin,
  MessageSquare,
  MousePointerClick,
  Phone,
  Radar,
  CalendarClock,
  ClipboardCheck,
  ReceiptText,
  ScanLine,
  Truck,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupAlerts } from "@/lib/alerts";
import type { ActivityEvent, ActivityType } from "@/lib/types";
import { TimeAgo } from "./time-ago";

export const TYPE_ICON: Record<ActivityType, typeof Radar> = {
  load_sourced: Radar,
  scoring_done: ScanLine,
  negotiation_email: Mail,
  negotiation_sms: MessageSquare,
  call_started: Phone,
  call_completed: Phone,
  rate_confirmed: CheckCircle2,
  booked: CheckCircle2,
  tms_synced: Database,
  dispatched: Truck,
  check_call: MapPin,
  document_captured: FileText,
  delivered: Flag,
  chained: Link2,
  escalation: AlertTriangle,
  load_offered: ListChecks,
  offer_selected: MousePointerClick,
  incident: LifeBuoy,
  maintenance: Wrench,
  dvir: ClipboardCheck,
  load_cancelled: Ban,
  time_off: CalendarClock,
  truck_reassigned: ArrowRightLeft,
  expense: ReceiptText,
};

export const SEVERITY_TONE: Record<ActivityEvent["severity"], string> = {
  info: "bg-ink-100 text-ink-600",
  success: "bg-live-soft text-[var(--accent-live)]",
  warning: "bg-warn-soft text-[var(--accent-warn)]",
  danger: "bg-danger-soft text-[var(--accent-danger)]",
};

export function ActivityFeed({ events, className, dense }: { events: ActivityEvent[]; className?: string; dense?: boolean }) {
  if (events.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">No activity yet. The AI is watching the boards.</p>;
  }
  return (
    <ul className={cn("flex flex-col", className)}>
      {events.map((event) => {
        const Icon = TYPE_ICON[event.type];
        return (
          <li key={event.id} className={cn("flex gap-3 border-b border-line/70 py-3 last:border-0 animate-rise-in", dense && "py-2.5")}>
            <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", SEVERITY_TONE[event.severity])}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13px] font-medium text-ink-900">{event.message}</p>
                <TimeAgo iso={event.timestamp} className="shrink-0 text-[11px] tabular text-ink-400" />
              </div>
              {event.detail && <p className="mt-0.5 truncate text-xs text-ink-500">{event.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The bell's list: alerts of one kind close together fold into one line ("3 loads delivered") that opens up. */
export function GroupedAlertFeed({ events, limit = 8 }: { events: ActivityEvent[]; limit?: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = groupAlerts(events).slice(0, limit);
  if (groups.length === 0) return <ActivityFeed events={[]} />;
  return (
    <ul className="flex flex-col">
      {groups.map((g) => {
        const Icon = TYPE_ICON[g.lead.type];
        const many = g.items.length > 1;
        const open = openId === g.id;
        const row = (
          <>
            <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", SEVERITY_TONE[g.lead.severity])}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13px] font-medium text-ink-900">{g.title}</p>
                <TimeAgo iso={g.lead.timestamp} className="shrink-0 text-[11px] tabular text-ink-400" />
              </div>
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-500">
                {many ? (
                  <>
                    <span className="truncate">{g.items.map((i) => i.detail ?? i.message).slice(0, 2).join(" · ")}</span>
                    <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
                  </>
                ) : (
                  g.lead.detail
                )}
              </p>
            </div>
          </>
        );
        return (
          <li key={g.id} className="border-b border-line/70 last:border-0">
            {many ? (
              <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : g.id)} className="flex w-full gap-3 py-2.5">
                {row}
              </button>
            ) : (
              <div className="flex gap-3 py-2.5">{row}</div>
            )}
            {many && open && <ActivityFeed events={g.items} dense className="mb-2 ml-10 rounded-xl bg-ink-50 px-3" />}
          </li>
        );
      })}
    </ul>
  );
}
