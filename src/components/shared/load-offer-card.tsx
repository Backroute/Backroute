"use client";

import { useState } from "react";
import { Home, MessageCircle, Repeat, Send, Sparkles, Truck as TruckIcon, X, Zap } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { loadHighlight } from "@/lib/scoring";
import type { OfferAskDraft } from "@/lib/engine";
import type { Broker, Driver, Load, Truck } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadScoreBadge } from "./load-score";
import { BrokerTrustBadge } from "./broker-trust-badge";
import { TimeAgo } from "./time-ago";

const TIER_TONE = { preferred: "success", standard: "neutral", watch: "warning" } as const;

type AskState = "idle" | "composing" | "pending" | "replied";

export function LoadOfferCard({
  load,
  broker,
  truck,
  driver,
  onSelect,
  onAsk,
  onAskResolve,
  compact,
}: {
  load: Load;
  broker: Broker | undefined;
  /** Shown as a small identity line on the card when this offer is for a specific truck/driver (carrier context managing several). */
  truck?: Truck;
  driver?: Driver;
  onSelect: () => void;
  /** Ask the AI a question about this offer before committing — detention, schedule, payment terms, anything but rate (already set from data; push further after selecting). Phase one: logs the ask and returns what to show while waiting on the broker. */
  onAsk?: (text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
  /** Phase two: the broker's actual answer, applied a moment later. */
  onAskResolve?: (draft: OfferAskDraft) => string;
  compact?: boolean;
}) {
  const [askState, setAskState] = useState<AskState>("idle");
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");

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
      const finalReply = onAskResolve(draft);
      setReply(finalReply);
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

  const dark = load.recommended;

  return (
    <div
      className={cn(
        "flex flex-col gap-3.5 rounded-2xl border p-4",
        dark ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <LoadScoreBadge score={load.score} size="xl" invert={dark} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", dark ? "text-white" : "text-ink-950")}>
            {load.lane.origin}, {load.lane.originState}
            <span className={dark ? "text-white/40" : "text-ink-300"}> → </span>
            {load.lane.destination}, {load.lane.destState}
          </p>
          <p className={cn("mt-0.5 flex flex-wrap items-center gap-1 text-xs", dark ? "text-white/60" : "text-ink-500")}>
            {broker?.company ?? "Broker"}
            {broker && (
              <Badge tone={dark ? "dark" : TIER_TONE[broker.tier]} className={cn("!text-[10px] !px-1.5 !py-0", dark && "!bg-white/15 !text-white")}>
                {broker.tier}
              </Badge>
            )}
            <span>· {load.equipmentType} · {load.lane.miles} mi</span>
          </p>
          {broker && (
            <p className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]", dark ? "text-white/60" : "text-ink-500")}>
              <BrokerTrustBadge broker={broker} />
              <span>Pays in ~{broker.avgDaysToPay} days</span>
              {load.surchargePct ? <span className={dark ? "text-amber-200" : "text-[var(--accent-warn)]"}>AI asked +{load.surchargePct}% for slow pay</span> : null}
            </p>
          )}
          {(truck || driver) && (
            <p className={cn("mt-1 flex items-center gap-1 text-[11px] font-medium", dark ? "text-white/60" : "text-ink-500")}>
              <TruckIcon className="h-3 w-3 shrink-0" />
              {truck?.unitNumber ?? "Unassigned"}
              {driver && ` · ${driver.name}`}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {dark && (
              <Badge tone="dark" className="!bg-white/15 !text-white gap-1">
                <Sparkles className="h-3 w-3" /> AI pick
              </Badge>
            )}
            {load.homeTimeFit && (
              <Badge tone={dark ? "dark" : "info"} className={dark ? "!bg-white/15 !text-white gap-1" : "gap-1"}>
                <Home className="h-3 w-3" /> Home-time fit
              </Badge>
            )}
          </div>
        </div>
      </div>

      <p className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium", dark ? "bg-white/10 text-white/80" : "bg-ink-50 text-ink-600")}>
        <Zap className="h-3 w-3 shrink-0" /> {highlight}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total offer" value={formatCurrency(load.targetRate)} dark={dark} pulse={askState === "pending"} />
        <Stat label="Est. net" value={formatCurrency(load.netProfit ?? 0)} dark={dark} pulse={askState === "pending"} emphasize />
        <Stat label="Rate / mi" value={`$${(load.rpm ?? 0).toFixed(2)}`} dark={dark} pulse={askState === "pending"} />
        <Stat label="Pickup" value={load.pickupWindow.split(",")[0]} dark={dark} />
      </div>

      {(load.loadHome || load.endsNearHome) && (
        <div className={cn("rounded-xl px-2.5 py-2 text-xs", dark ? "bg-white/10 text-white/80" : "bg-ink-50 text-ink-600")}>
          {load.loadHome ? (
            <>
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Repeat className="h-3 w-3 shrink-0" /> Whole trip, est. net
                </span>
                <span className={cn("font-semibold tabular", dark ? "text-white" : "text-ink-950")}>
                  {formatCurrency((load.netProfit ?? 0) + load.loadHome.estNet)}
                </span>
              </p>
              <p className={cn("mt-0.5 text-[11px]", dark ? "text-white/55" : "text-ink-500")}>
                Likely load home: {load.loadHome.origin} → {load.loadHome.destination}, about {formatCurrency(load.loadHome.estNet)} net
                {load.loadHome.deadheadMiles > 30 ? ` after ${load.loadHome.deadheadMiles} empty mi` : ""}. An estimate, not booked yet.
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 font-medium">
              <Home className="h-3 w-3 shrink-0" /> Delivers near the driver&apos;s home, so no load home is needed.
            </p>
          )}
        </div>
      )}

      {onAsk && onAskResolve && askState !== "idle" ? (
        <div className={cn("rounded-xl p-2.5", dark ? "bg-white/10" : "bg-ink-50")}>
          {askState === "composing" ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask about detention, scheduling, or anything else…"
                className={cn(
                  "min-w-0 flex-1 rounded-lg border bg-transparent px-2.5 py-1.5 text-xs outline-none",
                  dark ? "border-white/20 text-white placeholder:text-white/40 focus:border-white/40" : "border-line placeholder:text-ink-300 focus:border-ink-400",
                )}
              />
              <button
                onClick={handleSend}
                disabled={!text.trim()}
                aria-label="Send"
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg disabled:opacity-40",
                  dark ? "bg-white text-ink-950" : "bg-ink-950 text-white",
                )}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={reset}
                aria-label="Cancel"
                className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", dark ? "text-white/50 hover:bg-white/10" : "text-ink-400 hover:bg-ink-100")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <MessageCircle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", askState === "pending" && "animate-pulse", dark ? "text-white/60" : "text-ink-400")} />
              <div className="min-w-0 flex-1">
                <p className={cn("text-xs leading-relaxed", askState === "pending" && "animate-pulse", dark ? "text-white/90" : "text-ink-700")}>{reply}</p>
                {askState === "replied" && (
                  <button
                    onClick={reset}
                    className={cn("mt-1.5 text-[11px] font-medium underline", dark ? "text-white/60 hover:text-white" : "text-ink-400 hover:text-ink-700")}
                  >
                    Ask something else
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex gap-2">
        {onAsk && onAskResolve && askState === "idle" && (
          <Button
            size={compact ? "sm" : "md"}
            variant={dark ? "secondary" : "outline"}
            className={dark ? "!bg-white/15 !text-white hover:!bg-white/25" : ""}
            onClick={() => setAskState("composing")}
          >
            <MessageCircle className="h-3.5 w-3.5" /> Ask a question
          </Button>
        )}
        <Button
          size={compact ? "md" : "lg"}
          variant={dark ? "secondary" : "primary"}
          className={cn(dark ? "!bg-white !text-ink-950 hover:!bg-white/90" : "", "flex-1 !font-semibold")}
          onClick={onSelect}
        >
          Select this load
        </Button>
      </div>

      <p className={cn("text-center text-[10px]", dark ? "text-white/35" : "text-ink-300")}>
        Sourced from {load.source} · <TimeAgo iso={load.createdAt} />
      </p>
    </div>
  );
}

function Stat({ label, value, dark, pulse, emphasize }: { label: string; value: string; dark?: boolean; pulse?: boolean; emphasize?: boolean }) {
  return (
    <div className={cn("rounded-xl px-2.5 py-2", dark ? "bg-white/10" : "bg-ink-50", pulse && "animate-pulse")}>
      <p className={cn("text-[10px] uppercase tracking-wide", dark ? "text-white/50" : "text-ink-400")}>{label}</p>
      <p className={cn("mt-0.5 tabular font-semibold", emphasize ? "text-base" : "text-xs", dark ? "text-white" : "text-ink-950")}>{value}</p>
    </div>
  );
}
