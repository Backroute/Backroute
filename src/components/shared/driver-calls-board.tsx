"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, PhoneCall } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { useStore } from "@/lib/store";
import { KIND_LABEL } from "@/lib/dispatch-calls";
import { PRIMARY_CARRIER_ID } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { DispatchCall } from "@/lib/types";

const STATUS: Record<DispatchCall["status"], { label: string; tone: "success" | "info" | "neutral" | "warning" | "dark" }> = {
  live: { label: "On the phone", tone: "success" },
  ringing: { label: "Ringing", tone: "info" },
  queued: { label: "Up next", tone: "neutral" },
  held: { label: "Held", tone: "neutral" },
  missed: { label: "Texted instead", tone: "warning" },
  done: { label: "Done", tone: "neutral" },
  dropped: { label: "Not needed", tone: "neutral" },
};

/** The load a call is about; for a load offer, only the one that got booked. */
function loadLink(call: DispatchCall): string | undefined {
  if (call.kind !== "next_load") return call.loadId;
  const booked = call.effects.find((e) => e.type === "book");
  return call.status === "done" && booked?.type === "book" ? booked.loadId : undefined;
}

/** Calls happening right now first; everything else newest first. */
const ORDER: DispatchCall["status"][] = ["live", "ringing"];

/**
 * The AI's calls to drivers as the owner sees them: who it's on the phone with right now, what was agreed, and the
 * whole conversation a tap away. Nothing to do here unless a driver asks for a person, which also lands in Needs you.
 */
export function DriverCallsBoard({ limit = 6 }: { limit?: number }) {
  const calls = useStore((s) => s.dispatchCalls);
  const drivers = useStore((s) => s.drivers);
  const [open, setOpen] = useState<string | null>(null);

  const mine = calls
    .filter((c) => c.carrierId === PRIMARY_CARRIER_ID && c.status !== "dropped")
    .sort((a, b) => {
      const ra = ORDER.indexOf(a.status);
      const rb = ORDER.indexOf(b.status);
      if (ra !== rb) return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb);
      return Date.parse(b.endedAt ?? b.createdAt) - Date.parse(a.endedAt ?? a.createdAt);
    })
    .slice(0, limit);
  const live = calls.filter((c) => c.carrierId === PRIMARY_CARRIER_ID && c.status === "live").length;

  return (
    <section aria-labelledby="driver-calls-title" className="rounded-3xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="driver-calls-title" className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <PhoneCall className="h-4 w-4" /> Driver calls
            {live > 0 && <Badge tone="success" dot>{live} live</Badge>}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            The AI calls drivers like a dispatcher would. Whatever gets agreed updates the load and both apps when it hangs up.
          </p>
        </div>
      </div>

      {mine.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-ink-50 px-4 py-5 text-center text-xs text-ink-500">
          No calls yet. The AI calls when there&apos;s a load to offer, a pickup number to give, or a change on the road.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {mine.map((call) => {
            const driver = drivers.find((d) => d.id === call.driverId);
            const st = STATUS[call.status];
            const expanded = open === call.id;
            const summary =
              call.status === "held"
                ? `${call.heldReason}. Texted, will call if it still matters`
                : call.status === "live"
                  ? call.lines.at(-1)?.text
                  : call.status === "ringing"
                    ? "Calling now"
                    : call.outcome;
            return (
              <li key={call.id} className="py-3 first:pt-0 last:pb-0">
                <button type="button" onClick={() => setOpen(expanded ? null : call.id)} aria-expanded={expanded} className="flex w-full items-start gap-3 text-left">
                  <Avatar name={driver?.name ?? "Driver"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink-950">
                      {driver?.name ?? "Driver"} <span className="font-normal text-ink-500">· {KIND_LABEL[call.kind]}</span>
                    </p>
                    {summary && <p className={cn("mt-0.5 text-xs text-ink-500", call.status !== "live" && "truncate")}>{summary}</p>}
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={st.tone} dot={call.status === "live" || call.status === "ringing"}>{st.label}</Badge>
                    <span className="flex items-center gap-1 text-[11px] text-ink-400">
                      <TimeAgo iso={call.endedAt ?? call.answeredAt ?? call.createdAt} />
                      {call.lines.length > 0 && (expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div className="ml-10 mt-3 rounded-2xl bg-ink-50 p-3">
                    {call.lines.length === 0 ? (
                      <p className="text-xs text-ink-500">
                        {call.status === "held"
                          ? `The AI didn't ring: ${call.heldReason?.toLowerCase()}. The driver got the details by text.`
                          : call.status === "missed"
                            ? "Nobody picked up, so the AI texted the details instead."
                            : "Nothing said yet."}
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {call.lines.map((l, i) => (
                          <li key={i} className="text-xs leading-relaxed">
                            <span className="font-semibold text-ink-950">{l.speaker === "ai" ? "AI" : driver?.name.split(" ")[0] ?? "Driver"}: </span>
                            <span className="text-ink-700">{l.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {loadLink(call) && (
                      <Link href={`/carrier/loads/${loadLink(call)}`} className="mt-3 inline-block text-xs font-medium text-ink-950 underline underline-offset-2">
                        Open the load
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
