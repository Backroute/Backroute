"use client";

import { useState } from "react";
import { ChevronDown, Home, MessageCircle, Send, Sparkles, X } from "lucide-react";
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
import { useMounted } from "@/lib/hooks";
import { stopDates, type StopWhen } from "@/lib/load-dates";

type AskState = "idle" | "composing" | "pending" | "replied";

const RELOAD = { strong: "Easy", fair: "Fair", weak: "Slow" } as const;

/** Rough wheels-turning time at a truck's average, for a sense of the run (not a plan: breaks aren't in it). */
function driveTime(miles: number) {
  const h = miles / 50;
  if (h < 1) return `about ${Math.max(5, Math.round((h * 60) / 5) * 5)} min`;
  return `about ${Math.round(h)} h`;
}

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
  const mounted = useMounted();

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

  // Real dates once on the phone (the server doesn't know the viewer's day); the load's own words until then.
  const dates = mounted ? stopDates(load) : null;

  // The rate first, then every cost that comes out of it, down to what's left: the whole sum, in the open.
  const costs = [
    { label: "Fuel", amount: load.fuelCost },
    { label: "Tolls", amount: load.tollCost },
    { label: load.deadheadMiles > 0 ? `Empty miles (${load.deadheadMiles} mi)` : "Empty miles", amount: load.deadheadCost },
    { label: "Backroute fee (2%)", amount: load.commission },
  ].filter((c) => c.amount > 0);

  const facts = [
    { label: "Drive", value: driveTime(load.lane.miles) },
    { label: "Empty miles", value: load.deadheadMiles > 0 ? `${load.deadheadMiles} mi` : "None" },
    load.reloadMarket && !load.lane.moveKind
      ? { label: "Reload", value: RELOAD[load.reloadMarket] }
      : { label: "Weight", value: load.weight ? `${Math.round(load.weight / 1000)}k lb` : "—" },
  ];

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
      <ol className="mt-5 grid grid-cols-[1.25rem_1fr] gap-x-3">
        <li className="contents">
          <span className="flex flex-col items-center pt-[7px]">
            <span className="h-3 w-3 shrink-0 rounded-full bg-ink-950" />
            <span className="mt-[7px] w-0.5 flex-1 rounded-t-full bg-ink-200" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink-950">
              {load.lane.origin}, <span className="text-ink-400">{load.lane.originState}</span>
            </p>
            <StopDate stop="Pickup" when={dates?.pickup} raw={load.pickupWindow} />
          </div>
        </li>
        <li className="contents">
          <span className="flex justify-center">
            <span className="w-0.5 bg-ink-200" />
          </span>
          <p className="py-3 text-sm font-medium tabular text-ink-500">
            {load.lane.miles.toLocaleString()} mi
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
            <StopDate stop="Delivery" when={dates?.delivery} raw={load.deliveryWindow} />
          </div>
        </li>
      </ol>

      {/* Three facts in the same place on every card, so a row of cards reads across (like the fields on a boarding pass). */}
      <dl className="mt-5 grid grid-cols-3 divide-x divide-line border-y border-line py-3">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0 px-3 first:pl-0 last:pr-0">
            <dt className="truncate text-xs text-ink-500">{f.label}</dt>
            <dd className="mt-0.5 truncate text-[17px] font-semibold tabular tracking-[-0.01em] text-ink-950">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 rounded-[20px] bg-ink-100 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-ink-500">{load.lane.moveKind ? "Pays per move" : "Load pays"}</p>
          <p className="text-sm font-semibold tabular text-ink-950">
            ${(load.rpm ?? 0).toFixed(2)}
            <span className="font-normal text-ink-500">/mi</span>
          </p>
        </div>
        <p className="mt-1 text-[44px] font-semibold leading-none tracking-[-0.05em] tabular text-ink-950">{formatCurrency(load.targetRate)}</p>
        {costs.length > 0 && (
          <dl className="mt-4 flex flex-col gap-1.5 border-t border-line-strong pt-3 text-sm tabular">
            {costs.map((c) => (
              <div key={c.label} className="flex justify-between gap-3">
                <dt className="text-ink-600">{c.label}</dt>
                <dd className="text-ink-600">−{formatCurrency(c.amount)}</dd>
              </div>
            ))}
            <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line-strong pt-2.5">
              <dt className="font-semibold text-ink-950">{owner ? "You keep" : "Left after costs"}</dt>
              <dd className="text-[17px] font-semibold text-ink-950">{formatCurrency(load.netProfit ?? 0)}</dd>
            </div>
          </dl>
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

/** "Pickup · Sun, Oct 4 (today) · 9 am–6 pm": the date stands out; the load's own words if it has no date. */
function StopDate({ stop, when, raw }: { stop: string; when: StopWhen | null | undefined; raw: string }) {
  return (
    <p className="mt-0.5 text-[15px] leading-snug text-ink-500">
      {stop} ·{" "}
      <span className="font-semibold text-ink-950">{when?.date ?? raw.charAt(0).toUpperCase() + raw.slice(1)}</span>
      {when?.relative && ` (${when.relative.toLowerCase()})`}
      {when?.time && (
        <>
          {" · "}
          <span className="whitespace-nowrap tabular">{when.time}</span>
        </>
      )}
    </p>
  );
}
