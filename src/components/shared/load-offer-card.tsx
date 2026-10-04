"use client";

import { useState } from "react";
import { ChevronDown, Home, MessageCircle, Repeat, Send, Sparkles, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { formatHours } from "@/lib/home";
import { MOVE_LABEL } from "@/lib/run-types";
import { loadHighlight } from "@/lib/scoring";
import type { OfferAskDraft } from "@/lib/engine";
import type { Broker, Load } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { LoadScoreBadge } from "./load-score";
import { BrokerTrustBadge } from "./broker-trust-badge";
import { TimeAgo } from "./time-ago";
import { Lane } from "@/components/ui/lane";

type AskState = "idle" | "composing" | "pending" | "replied";

/**
 * One load to choose. Four things up front (where, the money, pickup, the one reason it's a good fit) and one button;
 * everything else is under Details. The driver never sees the broker's credit or fraud checks: that's the owner's call.
 */
export function LoadOfferCard({
  load,
  broker,
  viewer = "owner",
  onSelect,
  onAsk,
  onAskResolve,
}: {
  load: Load;
  broker: Broker | undefined;
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
  const askLabel = real ? (load.listedRate > 0 ? `Backroute asks ${formatCurrency(load.targetRate)} (posted ${formatCurrency(load.listedRate)})` : `Backroute asks ${formatCurrency(load.targetRate)}`) : null;

  const when = (w: string) => {
    const [day, ...rest] = w.split(", ");
    return { day: day.charAt(0).toUpperCase() + day.slice(1), time: rest.join(", ") };
  };
  const pickup = when(load.pickupWindow);
  const delivery = when(load.deliveryWindow);

  // What the rate turns into for the owner: what they keep, and where the rest goes.
  const costs = [
    { label: "Fuel", amount: load.fuelCost },
    { label: "Tolls", amount: load.tollCost },
    { label: "Empty miles", amount: load.deadheadCost },
    { label: "Fee", amount: load.commission },
  ].filter((c) => c.amount > 0);
  const keep = Math.max(0, load.netProfit ?? 0);
  const keepShare = load.targetRate > 0 ? Math.min(100, Math.round((keep / load.targetRate) * 100)) : 0;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-[28px] border bg-white p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_16px_40px_-24px_rgb(0_0_0/0.22)] transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgb(0_0_0/0.04),0_28px_56px_-28px_rgb(0_0_0/0.3)]",
        load.recommended ? "border-ink-950 ring-1 ring-ink-950" : "border-line",
      )}
    >
      {load.recommended && (
        <span className="absolute -top-3 left-6 rounded-full bg-ink-950 px-3 py-1 text-xs font-semibold text-white">Best fit</span>
      )}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 pt-1">
          <p className="truncate text-[15px] font-semibold text-ink-950">{broker?.company ?? "Broker"}</p>
          <p className="mt-0.5 truncate text-sm text-ink-500">
            {load.equipmentType}
            {load.weight ? ` · ${Math.round(load.weight / 1000)}k lb` : ""}
            {load.lane.moveKind ? ` · ${MOVE_LABEL[load.lane.moveKind]}` : ""}
          </p>
        </div>
        <LoadScoreBadge score={load.score} size="xl" />
      </header>

      {/* The run, top to bottom like a trip in Maps: where it starts, how far, where it ends, and when. */}
      <h3 className="sr-only">
        <Lane from={load.lane.origin} to={load.lane.destination} />
      </h3>
      <ol className="mt-5 grid grid-cols-[1.25rem_1fr_auto] gap-x-3">
        <li className="contents">
          <span className="flex flex-col items-center pt-[7px]">
            <span className="h-3 w-3 shrink-0 rounded-full bg-ink-950" />
            <span className="mt-[7px] w-0.5 flex-1 rounded-t-full bg-ink-200" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink-950">
              {load.lane.origin}, <span className="text-ink-400">{load.lane.originState}</span>
            </p>
            <p className="text-sm text-ink-500">Pickup</p>
          </div>
          <div className="text-right">
            <p className="pt-1 text-[15px] font-semibold text-ink-950">{pickup.day}</p>
            <p className="text-sm tabular text-ink-500">{pickup.time}</p>
          </div>
        </li>
        <li className="contents">
          <span className="flex justify-center">
            <span className="w-0.5 bg-ink-200" />
          </span>
          <p className="col-span-2 py-3 text-sm font-medium tabular text-ink-500">
            {load.lane.miles.toLocaleString()} mi
            {load.deadheadMiles > 0 ? <span className="font-normal text-ink-400"> · {load.deadheadMiles} empty to pickup</span> : null}
          </p>
        </li>
        <li className="contents">
          <span className="flex justify-center pt-[7px]">
            <span className="h-3 w-3 rounded-full border-[3px] border-ink-950 bg-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink-950">
              {load.lane.destination}, <span className="text-ink-400">{load.lane.destState}</span>
            </p>
            <p className="text-sm text-ink-500">Delivery</p>
          </div>
          <div className="text-right">
            <p className="pt-1 text-[15px] font-semibold text-ink-950">{delivery.day}</p>
            <p className="text-sm tabular text-ink-500">{delivery.time}</p>
          </div>
        </li>
      </ol>

      <div className="mt-5 rounded-[20px] bg-ink-100 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-ink-500">{owner ? "You keep" : load.lane.moveKind ? "Flat per move" : "Load pays"}</p>
            <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.045em] tabular text-ink-950">
              {formatCurrency(owner ? (load.netProfit ?? 0) : load.targetRate)}
            </p>
          </div>
          <div className="pb-0.5 text-right">
            <p className="text-[15px] font-semibold tabular text-ink-950">
              ${(load.rpm ?? 0).toFixed(2)}
              <span className="font-normal text-ink-500">/mi</span>
            </p>
            {owner && <p className="text-sm tabular text-ink-500">of {formatCurrency(load.targetRate)}</p>}
          </div>
        </div>
        {owner && load.targetRate > 0 && (
          <>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-ink-300" role="img" aria-label={`You keep ${keepShare}% of the rate`}>
              <span className="h-full rounded-full bg-ink-950" style={{ width: `${keepShare}%` }} />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular text-ink-500">
              <span className="font-medium text-ink-950">{keepShare}% yours</span>
              {costs.map((c) => (
                <span key={c.label}>
                  {c.label} {formatCurrency(c.amount)}
                </span>
              ))}
            </p>
          </>
        )}
      </div>

      <p className="mt-4 inline-flex items-center gap-2 self-start rounded-full bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-800">
        {reason === highlight ? <Sparkles className="h-4 w-4 shrink-0 text-ink-500" /> : <Home className="h-4 w-4 shrink-0 text-ink-500" />}
        {reason}
      </p>
      {askLabel && (
        <p className="mt-2 text-xs text-ink-500">
          {askLabel} · {load.source}
        </p>
      )}

      {open && (
        <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-sm text-ink-600">
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
        <div className="mt-4 rounded-xl bg-ink-50 p-2.5">
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

      <div className="mt-auto flex flex-col gap-3 pt-5">
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
    </article>
  );
}
