"use client";

import { useState } from "react";
import { ChevronDown, Home, Layers, MessageCircle, Moon, Repeat, Send, Sparkles, X } from "lucide-react";
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
import { optionScore, planLabel, planSegments, planStops, planTotals, type PlanStop } from "@/lib/plans";
import type { Crew } from "@/lib/hos-plan";

type AskState = "idle" | "composing" | "pending" | "replied";

const RELOAD = { strong: "Easy", fair: "Fair", weak: "Slow" } as const;

/** Rough wheels-turning time at a truck's average, for a sense of the run (not a plan: breaks aren't in it). */
function driveTime(miles: number) {
  const h = miles / 50;
  if (h < 1) return `${Math.max(5, Math.round((h * 60) / 5) * 5)} min`;
  return `${Math.round(h)} h`;
}

/**
 * One choice: a load, or a plan of several the AI put together (back to back, or partials sharing the trailer). Up
 * front: every stop in order with its date and the dock's hours, the miles and days, what it all pays and what's left,
 * the one reason it's a good fit, and one button. Everything else is under Details. The driver never sees the broker's
 * credit or fraud checks: that's the owner's call.
 */
/** "Overnight rest near Amarillo, TX", or the week's reset when the 70 hours run out. */
function restWords(r: { place: string; hours: number }): string {
  const what = r.hours >= 34 ? "34-hour reset" : r.hours < 10 ? `${Math.round(r.hours)}-hour rest (split sleeper)` : "Overnight rest";
  return r.place === "on the way" ? `${what} on the way` : `${what} near ${r.place}`;
}

export function LoadOfferCard({
  load,
  legs: givenLegs,
  broker,
  brokers,
  crew,
  viewer = "owner",
  onSelect,
  onAsk,
  onAskResolve,
}: {
  load: Load;
  /** Every load of a plan, in order (the first is `load`). A single load when absent. */
  legs?: Load[];
  broker: Broker | undefined;
  /** Each load's broker, for a plan. */
  brokers?: Map<string, Broker>;
  /** Who drives it: a team truck runs through the night, a solo driver stops for 10 hours after 11 of driving. */
  crew?: Crew;
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

  const legs = givenLegs?.length ? givenLegs : [load];
  const isPlan = legs.length > 1;
  const last = legs[legs.length - 1];
  const brokerOf = (l: Load) => (l.id === load.id ? broker : brokers?.get(l.brokerId)) ?? brokers?.get(l.brokerId);

  // Every stop in order, the drive between each, and the whole thing added up: pay, costs, miles, days, rests.
  const stops = planStops(legs);
  const segments = planSegments(legs, stops);
  const totals = planTotals(legs, crew);
  // Real dates once on the phone (the server doesn't know the viewer's day); the load's own words until then.
  const datesOf = (l: Load) => (mounted ? stopDates(l) : null);
  // Days out: the hours from the first pickup to the last drop as the docks booked them, so a drop the next morning is
  // still a day's work, not two. The clocks alone (no dates on the loads) say how long when the windows don't.
  const whenOf = (stop: PlanStop | undefined) => (stop && !stop.extra ? datesOf(stop.load)?.[stop.kind === "pickup" ? "pickup" : "delivery"] : undefined);
  const firstWhen = whenOf(stops[0]);
  const lastWhen = whenOf(stops[stops.length - 1]);
  const span = firstWhen?.at !== undefined && lastWhen?.at !== undefined ? lastWhen.at - firstWhen.at : firstWhen?.day !== undefined && lastWhen?.day !== undefined ? lastWhen.day - firstWhen.day + 86_400_000 : -1;
  const days = span > 0 ? Math.max(1, Math.ceil(span / 86_400_000 - 1e-9)) : totals.days;
  const label = planLabel(legs, days);

  const planReason = isPlan
    ? load.plan?.kind === "shared_trailer"
      ? `${legs.length} partials, one run`
      : last.hoursHomeAfter !== undefined && last.hoursHomeAfter < 3
        ? "Ends near home"
        : `Reloads within ${Math.max(...legs.slice(1).map((l) => l.deadheadMiles))} mi of each drop`
    : load.teamRate
      ? "Team freight: pays 20% more to get there days sooner"
      : crew?.team && totals.driveHours > 11
        ? "Team: rolls straight through, no night stops"
        : totals.rests.some((r) => r.hours >= 34)
          ? "Includes the 34-hour reset the driver's week needs"
          : null;
  const shownReason = planReason ?? reason;

  const facts = [
    { label: "You drive", value: `${totals.totalMiles.toLocaleString()} mi` },
    days >= 2 ? { label: "Days out", value: `${days} days` } : { label: "Drive time", value: driveTime(totals.totalMiles) },
    last.reloadMarket && !last.lane.moveKind
      ? { label: isPlan ? "Reload at end" : "Reload", value: RELOAD[last.reloadMarket] }
      : { label: "Weight", value: load.weight ? `${Math.round(load.weight / 1000)}k lb` : "—" },
  ];
  const rate = totals.loadedMiles > 0 ? totals.pays / totals.loadedMiles : (load.rpm ?? 0);
  const score = isPlan ? optionScore(legs) : load.score;
  const brokerNames = [...new Set(legs.map((l) => brokerOf(l)?.company ?? "Broker"))];

  return (
    <article
      className={cn(
        "group relative flex h-full w-full flex-col rounded-[24px] border bg-white p-4 min-[400px]:p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_16px_40px_-24px_rgb(0_0_0/0.22)] transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgb(0_0_0/0.04),0_28px_56px_-28px_rgb(0_0_0/0.3)]",
        // The best one is the opposite colour of the page, so it's the first thing the eye lands on.
        load.recommended ? "theme-invert border-transparent shadow-[0_2px_4px_rgb(0_0_0/0.08),0_24px_48px_-20px_rgb(0_0_0/0.45)]" : "border-line",
      )}
    >
      {load.recommended && (
        <span className="absolute -top-3 left-5 rounded-full bg-[#276ef1] px-3 py-1 text-xs font-semibold text-[#ffffff] shadow-sm">Best fit</span>
      )}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 pt-0.5">
          {label && (
            <p className="mb-1 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--link)]">
              {load.plan?.kind === "shared_trailer" ? <Layers className="h-3.5 w-3.5" /> : isPlan ? <Repeat className="h-3.5 w-3.5" /> : null}
              {label}
            </p>
          )}
          <p className="truncate text-[15px] font-semibold text-ink-950">{brokerNames.join(" + ")}</p>
          <p className="mt-0.5 truncate text-sm text-ink-500">
            {load.equipmentType}
            {!isPlan && load.weight ? ` · ${Math.round(load.weight / 1000)}k lb` : ""}
            {load.lane.moveKind ? ` · ${MOVE_LABEL[load.lane.moveKind]}` : ""}
            {crew?.team ? " · Team" : ""}
          </p>
        </div>
        <LoadScoreBadge score={score} size="xl" dim={56} />
      </header>

      {/* The run, top to bottom like a trip in Maps: where it starts, how far, where it ends, and when. */}
      <h3 className="sr-only">
        <Lane from={load.lane.origin} to={load.lane.destination} />
      </h3>
      <ol className="mt-4 grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-3">
        {stops.map((stop, i) => {
          const when = stop.extra ? null : (datesOf(stop.load)?.[stop.kind === "pickup" ? "pickup" : "delivery"] ?? null);
          const raw = stop.extra ? (stop.window ?? "") : stop.kind === "pickup" ? stop.load.pickupWindow : stop.load.deliveryWindow;
          const seg = segments[i];
          const rests = totals.rests.filter((r) => r.afterStop === i);
          const isLast = i === stops.length - 1;
          return (
            <li key={`${stop.load.id}-${stop.kind}-${i}`} className="contents">
              <span className={cn("flex flex-col items-center", isLast ? "" : "pt-[7px]")}>
                {isLast && <span className="h-[7px] w-0.5 bg-ink-200" />}
                <StopDot first={i === 0} last={isLast} />
                {!isLast && <span className="mt-[6px] w-0.5 flex-1 bg-ink-200" />}
              </span>
              <StopPlace city={stop.city} state={stop.state} stop={stopName(stop, isPlan)} when={when} />
              <StopTime when={when} raw={raw} />
              {seg && (
                <>
                  <span className="flex justify-center">
                    <span className={cn("w-0.5", seg.loaded ? "bg-ink-200" : "bg-[repeating-linear-gradient(to_bottom,var(--ink-300)_0_4px,transparent_4px_8px)]")} />
                  </span>
                  <div className="col-span-2 py-1.5 text-[13px] tabular text-ink-500">
                    <p className="font-medium">
                      {seg.miles === 0 ? "Same dock" : `${seg.miles.toLocaleString()} mi ${seg.loaded ? "loaded" : "empty to the next pickup"}`}
                    </p>
                    {rests.map((r, k) => (
                      <p key={k} className="mt-0.5 flex items-center gap-1.5">
                        <Moon className="h-3.5 w-3.5 shrink-0" /> {restWords(r)}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>

      {/* Three facts in the same place on every card, so a row of cards reads across (like the fields on a boarding pass). */}
      <dl className="mt-3.5 grid grid-cols-3 divide-x divide-line border-y border-line py-2.5">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0 px-3 first:pl-0 last:pr-0">
            <dt className="truncate text-xs text-ink-500">{f.label}</dt>
            <dd className="truncate text-base font-semibold tabular tracking-[-0.01em] text-ink-950">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3.5 flex items-end justify-between gap-3 rounded-2xl bg-ink-100 px-4 py-2.5">
        <div>
          <p className="text-[13px] text-ink-500">{isPlan ? `${legs.length} loads pay` : load.lane.moveKind ? "Pays per move" : "Load pays"}</p>
          <p className="text-[34px] font-semibold leading-none tracking-[-0.045em] tabular text-ink-950">{formatCurrency(totals.pays)}</p>
        </div>
        <div className="pb-0.5 text-right text-[13px] tabular text-ink-500">
          <p>
            <span className="font-semibold text-ink-950">${rate.toFixed(2)}</span>/mi
          </p>
          {totals.costs.length > 0 && (
            <p>
              {owner ? "You keep " : ""}
              <span className="font-semibold text-ink-950">{formatCurrency(totals.net)}</span>
              {owner ? "" : " after costs"}
            </p>
          )}
        </div>
      </div>

      <p className="mt-2.5 inline-flex items-center gap-1.5 self-start rounded-full bg-ink-100 px-2.5 py-1 text-[13px] font-medium text-ink-800">
        {shownReason === highlight ? <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink-500" /> : <Home className="h-3.5 w-3.5 shrink-0 text-ink-500" />}
        {shownReason}
      </p>
      {askLabel && (
        <p className="mt-2 text-xs text-ink-500">
          {askLabel} · {load.source}
        </p>
      )}

      {open && (
        <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-sm text-ink-600">
          <dl className="mb-1.5 flex flex-col gap-1 tabular">
            {legs.map((l, i) => (
              <div key={l.id} className="flex justify-between gap-3 font-medium text-ink-950">
                <dt className="min-w-0 truncate">
                  {isPlan ? `Load ${i + 1}: ${l.lane.origin} to ${l.lane.destination} · ${brokerOf(l)?.company ?? "Broker"}` : "Load pays"}
                </dt>
                <dd>{formatCurrency(l.targetRate)}</dd>
              </div>
            ))}
            {totals.costs.map((c) => (
              <div key={c.label} className="flex justify-between gap-3">
                <dt>{c.label}</dt>
                <dd>−{formatCurrency(c.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold text-ink-950">
              <dt>{owner ? "You keep" : "Left after costs"}</dt>
              <dd>{formatCurrency(totals.net)}</dd>
            </div>
          </dl>
          {owner &&
            legs.map((l) => {
              const b = brokerOf(l);
              return b ? (
                <p key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <BrokerTrustBadge broker={b} />
                  <span>{isPlan ? `${b.company} pays` : "Pays"} in about {b.avgDaysToPay} days</span>
                  {l.surchargePct ? <span>· +{l.surchargePct}% asked for slow pay</span> : null}
                </p>
              ) : null;
            })}
          {isPlan && (
            <p>
              {load.plan?.kind === "shared_trailer"
                ? "Every load keeps its own broker, rate con and invoice. Backroute asks every broker at once, and if one gives their load away, the trip goes on without it."
                : "Backroute asks every broker at once. If one gives their load to someone else, it books another in its place so the plan still runs."}
            </p>
          )}
          {shownReason !== highlight && <p>{highlight}</p>}
          {real && load.market && (
            <p>
              Market: about {formatCurrency(Math.round(load.market.rpm * load.lane.miles))} (${load.market.rpm.toFixed(2)}/mi, {load.market.source})
              {load.listedRate > 0 && load.listedRate < load.market.rpm * load.lane.miles * 0.9 ? " · posted under market" : ""}
            </p>
          )}
          {!last.lane.moveKind && last.hoursHomeAfter !== undefined && (
            <p className="flex items-center gap-1.5">
              <Home className="h-3 w-3 shrink-0" />
              {!isPlan && load.homeTonight
                ? "Pickup, delivery and the drive home fit in one shift"
                : last.hoursHomeAfter < 1
                  ? `${isPlan ? "Ends" : "Delivers"} near home`
                  : `Leaves the driver about ${formatHours(last.hoursHomeAfter)} from home`}
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
                  <button onClick={reset} className="mt-1.5 text-xs font-medium text-[var(--link)] hover:underline">
                    Ask something else
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-3.5">
      <Button
        size="lg"
        className="w-full"
        disabled={asking}
        onClick={() => {
          if (real) setAsking(true);
          onSelect();
        }}
      >
        {real ? (asking ? "Asking the broker…" : "Ask to book it") : isPlan ? `Book all ${legs.length} loads` : "Select this load"}
      </Button>
      <div className="flex items-center justify-center gap-5 text-sm">
        {onAsk && onAskResolve && askState === "idle" && !isPlan && (
          <button type="button" onClick={() => setAskState("composing")} className="font-medium text-[var(--link)] hover:underline">
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

/** The city, and under it which stop it is and, when it's soon, "today" or "tomorrow". */
function StopPlace({ city, state, stop, when }: { city: string; state: string; stop: string; when: StopWhen | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-lg font-semibold leading-tight tracking-[-0.02em] text-ink-950 min-[400px]:text-[19px]">
        {city}, <span className="text-ink-400">{state}</span>
      </p>
      <p className="text-[13px] text-ink-500">
        {stop}
        {when?.relative ? ` · ${when.relative.toLowerCase()}` : ""}
      </p>
    </div>
  );
}

/** On the right: the stop's date, and the dock's hours in its own time zone; the load's own words if it has no date. */
function StopTime({ when, raw }: { when: StopWhen | null | undefined; raw: string }) {
  return (
    <div className="text-right">
      {(when?.date || raw) && <p className="pt-0.5 text-[15px] font-semibold leading-tight text-ink-950">{when?.date ?? raw.charAt(0).toUpperCase() + raw.slice(1)}</p>}
      {when?.time && <p className="whitespace-nowrap text-[13px] tabular text-ink-500">{when.time}</p>}
    </div>
  );
}

/** A stop's name under its city: which stop, and on a plan which load. */
function stopName(stop: PlanStop, isPlan: boolean): string {
  if (stop.extra) return stop.kind === "pickup" ? "Extra pickup" : "Drop on the way";
  const what = stop.kind === "pickup" ? "Pickup" : "Delivery";
  return isPlan ? `${what} · load ${stop.leg}` : what;
}

/** Filled for the first stop, a ring for the last, a small dot for the ones between. */
function StopDot({ first, last }: { first: boolean; last: boolean }) {
  if (first) return <span className="h-3 w-3 shrink-0 rounded-full bg-ink-950" />;
  if (last) return <span className="h-3 w-3 shrink-0 rounded-full border-[3px] border-ink-950 bg-white" />;
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ink-950 bg-white" />;
}
