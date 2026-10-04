"use client";

import { useState } from "react";
import { ChevronDown, Home, MessageCircle, Repeat, Send, Truck as TruckIcon, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { formatHours } from "@/lib/home";
import { MOVE_LABEL } from "@/lib/run-types";
import { loadHighlight } from "@/lib/scoring";
import type { OfferAskDraft } from "@/lib/engine";
import type { Broker, Driver, Load, Truck } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { LoadScoreBadge } from "./load-score";
import { BrokerTrustBadge } from "./broker-trust-badge";
import { TimeAgo } from "./time-ago";

type AskState = "idle" | "composing" | "pending" | "replied";

/**
 * One load to choose. Four things up front (where, the money, pickup, the one reason it's a good fit) and one button;
 * everything else is under Details. The driver never sees the broker's credit or fraud checks: that's the owner's call.
 */
export function LoadOfferCard({
  load,
  broker,
  truck,
  driver,
  viewer = "owner",
  onSelect,
  onAsk,
  onAskResolve,
}: {
  load: Load;
  broker: Broker | undefined;
  /** Which truck and driver it's for, when the owner is choosing for several. */
  truck?: Truck;
  driver?: Driver;
  viewer?: "owner" | "driver";
  onSelect: () => void;
  /** Ask the broker something before choosing (detention, schedule, payment terms). Logs the ask and returns what to show while waiting. */
  onAsk?: (text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
  /** The broker's actual answer, applied a moment later. */
  onAskResolve?: (draft: OfferAskDraft) => string;
}) {
  const [askState, setAskState] = useState<AskState>("idle");
  const [open, setOpen] = useState(false);
  // A real account's offers came from broker emails: the button asks the broker to book it, at Backroute's price.
  const real = useStore((s) => s.session.mode !== "demo");
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const owner = viewer === "owner";

  function handleSend() {
    const trimmed = text.trim();
    if (!onAsk || !onAskResolve || !trimmed || askState === "pending") return;
    const { draft, pendingReply, resolved } = onAsk(trimmed);
    if (!pendingReply) return;
    setReply(pendingReply);
    setText("");
    if (resolved) {
      setAskState("replied");
      return;
    }
    setAskState("pending");
    setTimeout(() => {
      setReply(onAskResolve(draft));
      setAskState("replied");
    }, 2400);
  }

  function reset() {
    setAskState("idle");
    setText("");
    setReply("");
  }

  const highlight = loadHighlight({
    rpm: load.rpm ?? 0,
    marketRpm: load.lane.marketRpm,
    deadheadMiles: load.deadheadMiles,
    miles: load.lane.miles,
    brokerReliability: broker?.reliability ?? 70,
    brokerTier: broker?.tier ?? "standard",
  });
  // The one reason, in the driver's terms when home is what it's about.
  const reason = load.homeTonight && !load.lane.moveKind ? "Home tonight" : load.homeTimeFit ? "Heads toward home" : highlight;
  const pickup = load.pickupWindow.split(",").slice(0, real ? 2 : 1).join(",");
  const askLabel = real ? (load.listedRate > 0 ? `Backroute asks ${formatCurrency(load.targetRate)} (posted ${formatCurrency(load.listedRate)})` : `Backroute asks ${formatCurrency(load.targetRate)}`) : null;

  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border bg-white p-4", load.recommended ? "border-ink-950" : "border-line")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {load.recommended && <p className="mb-1 text-xs font-semibold text-ink-950">Best fit</p>}
          <p className="text-[17px] font-semibold leading-snug tracking-tight text-ink-950">
            {load.lane.origin} <span className="text-ink-300">→</span> {load.lane.destination}
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            {broker?.company ?? "Broker"} · {load.equipmentType} · {load.lane.miles} mi
          </p>
        </div>
        <LoadScoreBadge score={load.score} />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-medium tabular tracking-tight text-ink-950">
            {formatCurrency(owner ? (load.netProfit ?? 0) : load.targetRate)}
          </p>
          <p className="text-xs text-ink-500">
            {owner ? `You keep, of ${formatCurrency(load.targetRate)}` : load.lane.moveKind ? `Flat per move · ${MOVE_LABEL[load.lane.moveKind]}` : `Load pays · $${(load.rpm ?? 0).toFixed(2)}/mi`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-ink-950">{pickup}</p>
          <p className="text-xs text-ink-500">Pickup</p>
        </div>
      </div>

      <p className="text-sm text-ink-600">{reason}</p>
      {askLabel && (
        <p className="text-xs text-ink-500">
          {askLabel} · {load.source}
        </p>
      )}

      {(truck || driver) && (
        <p className="flex items-center gap-1 text-xs text-ink-500">
          <TruckIcon className="h-3 w-3 shrink-0" />
          {truck?.unitNumber ?? "Unassigned"}
          {driver && ` · ${driver.name}`}
        </p>
      )}

      {open && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-xs text-ink-600">
          {owner && broker && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <BrokerTrustBadge broker={broker} />
              <span>Pays in about {broker.avgDaysToPay} days</span>
              {load.surchargePct ? <span>· +{load.surchargePct}% asked for slow pay</span> : null}
            </p>
          )}
          {owner && <p>Rate {formatCurrency(load.targetRate)} · ${(load.rpm ?? 0).toFixed(2)}/mi</p>}
          {reason !== highlight && <p>{highlight}</p>}
          {real && load.market && (
            <p>
              Market: about {formatCurrency(Math.round(load.market.rpm * load.lane.miles))} (${load.market.rpm.toFixed(2)}/mi, {load.market.source})
              {load.listedRate > 0 && load.listedRate < load.market.rpm * load.lane.miles * 0.9 ? " · posted under market" : ""}
            </p>
          )}
          {!load.lane.moveKind && load.hoursHomeAfter !== undefined && (
            <p className="flex items-center gap-1.5">
              <Home className="h-3 w-3 shrink-0" />
              {load.homeTonight
                ? "Pickup, delivery and the drive home fit in one shift"
                : load.hoursHomeAfter < 1
                  ? "Delivers near home"
                  : `Leaves the driver about ${formatHours(load.hoursHomeAfter)} from home`}
            </p>
          )}
          {!load.lane.moveKind && load.reloadMarket && !load.homeTonight && (
            <p className="flex items-center gap-1.5">
              <Repeat className="h-3 w-3 shrink-0" />
              {load.reloadMarket === "strong" ? "Easy to reload there" : load.reloadMarket === "fair" ? "Some loads out of there" : "Few loads out of there, so the next one may take longer"}
            </p>
          )}
          <p className="text-ink-400">
            From {load.source} · <TimeAgo iso={load.createdAt} />
          </p>
        </div>
      )}

      {onAsk && onAskResolve && askState !== "idle" && (
        <div className="rounded-xl bg-ink-50 p-2.5">
          {askState === "composing" ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask about detention, the schedule, anything…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-300 focus:border-ink-400"
              />
              <button onClick={handleSend} disabled={!text.trim()} aria-label="Send" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--action)] text-[var(--action-ink)] disabled:opacity-40">
                <Send className="h-3.5 w-3.5" />
              </button>
              <button onClick={reset} aria-label="Cancel" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-400 hover:bg-ink-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <MessageCircle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400", askState === "pending" && "animate-pulse")} />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm leading-relaxed text-ink-700", askState === "pending" && "animate-pulse")}>{reply}</p>
                {askState === "replied" && (
                  <button onClick={reset} className="mt-1.5 text-xs font-medium text-[var(--action)] hover:underline">
                    Ask something else
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Button
        size="lg"
        className="w-full"
        disabled={asking}
        onClick={() => {
          if (real) setAsking(true);
          onSelect();
        }}
      >
        {real ? (asking ? "Asking the broker…" : "Ask to book it") : "Select this load"}
      </Button>
      <div className="flex items-center justify-center gap-5 text-sm">
        {onAsk && onAskResolve && askState === "idle" && (
          <button type="button" onClick={() => setAskState("composing")} className="font-medium text-[var(--action)] hover:underline">
            Ask a question
          </button>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 font-medium text-ink-500 hover:text-ink-950">
          {open ? "Less" : "Details"} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
    </div>
  );
}
