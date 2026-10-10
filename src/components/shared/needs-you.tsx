"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowDown, CalendarClock, Check, ChevronDown, LifeBuoy, Loader2, Phone, Send, UserRound, X } from "lucide-react";
import { AttentionCard, SwipeAction, type AttentionTone } from "@/components/ui/attention";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TruckDriverChip } from "./truck-driver-chip";
import { DraftApproval, SourceTag } from "./draft-approval";
import { PortalApproval } from "./portal-approval";
import { RuleSuggestion } from "@/components/cloud/owner-rules";
import { useDriverRetention } from "./driver-retention";
import { answerDraft } from "@/lib/cloud/agent";
import { queueWithUndo, undo, usePending } from "@/lib/undo-queue";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads, useCarrierEscalations, useDriverMap, useTruckMap } from "@/lib/selectors";
import type { DraftPurpose, Escalation, Load } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { celebrate, haptic } from "@/lib/feedback";
import { LumperAsk } from "@/components/owner/lumper-ask";

/** Everything waiting on the owner, counted one way for the hero line, the badge and the list. */
export function useNeedsYou() {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const escalations = useCarrierEscalations().filter((e) => e.status !== "resolved");
  const pendingTimeOff = useStore((s) => s.timeOffRequests).filter((r) => r.carrierId === carrier.id && r.status === "pending");
  // A driver at a dock waiting on lumper money: the most time-sensitive thing a driver can ask for.
  const lumperAsks = useStore((s) => s.expenses).filter((e) => e.carrierId === carrier.id && e.upfront && e.status === "pending");
  const driversAtRisk = useDriverRetention().filter((r) => r.view.level === "at_risk");
  const offerGroups = useMemo(() => {
    const map = new Map<string, Load[]>();
    for (const load of loads) {
      if (load.stage !== "offered" || !load.offerGroupId) continue;
      map.set(load.offerGroupId, [...(map.get(load.offerGroupId) ?? []), load]);
    }
    return Array.from(map.entries());
  }, [loads]);
  // Escalations already handed to Backroute Support are listed but no longer wait on the carrier.
  const waiting = escalations.filter((e) => e.status !== "with_support");
  const count = waiting.length + pendingTimeOff.length + offerGroups.length + driversAtRisk.length + lumperAsks.length;
  // The part of it that can't wait: decisions only the owner can make now, and drivers at a dock waiting on money.
  const urgent = waiting.filter((e) => e.complexity === "critical").length + lumperAsks.length;
  const listed = escalations.filter((e) => !e.incidentId);
  return { escalations, listed, pendingTimeOff, lumperAsks, driversAtRisk, offerGroups, count, urgent, any: listed.length + pendingTimeOff.length + offerGroups.length + driversAtRisk.length + lumperAsks.length > 0 };
}

// ── Set aside for later (a left swipe): this browser tab only, back next visit. ───────────────────────────────────

const LATER_KEY = "backroute.later";
const laterListeners = new Set<() => void>();
let laterCache: string | null = null;
function readLater(): string {
  if (laterCache !== null) return laterCache;
  try {
    laterCache = sessionStorage.getItem(LATER_KEY) ?? "";
  } catch {
    laterCache = "";
  }
  return laterCache;
}
function setLater(ids: string[]) {
  laterCache = ids.join(",");
  try {
    sessionStorage.setItem(LATER_KEY, laterCache);
  } catch {}
  laterListeners.forEach((l) => l());
}
function useLater(): Set<string> {
  const raw = useSyncExternalStore(
    (cb) => {
      laterListeners.add(cb);
      return () => laterListeners.delete(cb);
    },
    readLater,
    () => "",
  );
  return useMemo(() => new Set(raw.split(",").filter(Boolean)), [raw]);
}

// ── Several of the same thing at once ──────────────────────────────────────────────────────────────────────────────

/** Drafts safe to send as a batch: standard paperwork and short notes, never a price the owner hasn't seen. */
const BATCH_PURPOSES: Partial<Record<DraftPurpose, [string, string]>> = {
  ack: ["short reply", "short replies"],
  detention: ["detention claim", "detention claims"],
  layover: ["layover claim", "layover claims"],
  tonu: ["TONU claim", "TONU claims"],
  payment_reminder: ["payment reminder", "payment reminders"],
  eta_update: ["ETA update", "ETA updates"],
  setup_packet: ["setup packet", "setup packets"],
  invoice: ["invoice", "invoices"],
};
const NOTE_LABELS = new Set(["got it", "ok", "okay", "noted"]);

interface Batch {
  key: string;
  label: string;
  verb: string;
  items: Escalation[];
  run: (e: Escalation) => Promise<string | null>;
}

function useBatches(listed: Escalation[], real: boolean): Batch[] {
  const resolve = useStore((s) => s.actions.resolveEscalation);
  return useMemo(() => {
    const open = listed.filter((e) => e.status === "open");
    const batches: Batch[] = [];
    if (real) {
      const byPurpose = new Map<DraftPurpose, Escalation[]>();
      for (const e of open) {
        const p = e.draft?.purpose;
        if (!e.draft || !p || !BATCH_PURPOSES[p] || e.suggestRule || e.portalTaskId) continue;
        byPurpose.set(p, [...(byPurpose.get(p) ?? []), e]);
      }
      for (const [p, items] of byPurpose) {
        if (items.length < 2) continue;
        batches.push({ key: `draft:${p}`, label: `${items.length} ${BATCH_PURPOSES[p]![1]}`, verb: "Send all", items, run: (e) => answerDraft(e.id, true) });
      }
    }
    const notes = open.filter((e) => !e.draft && !e.suggestRule && !e.portalTaskId && e.complexity === "routine" && e.recommendedAction === "approve" && NOTE_LABELS.has((e.recommendedLabel ?? "").toLowerCase()));
    if (notes.length >= 2)
      batches.push({
        key: "notes",
        label: `${notes.length} notes for you`,
        verb: "Mark all read",
        items: notes,
        run: async (e) => {
          resolve(e.id, true);
          return null;
        },
      });
    return batches;
  }, [listed, real, resolve]);
}

function BatchBar({ batches }: { batches: Batch[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  if (!batches.length) return null;
  const current = batches.find((b) => b.key === open);

  async function runAll(b: Batch) {
    setProgress({ done: 0, total: b.items.length, failed: [] });
    const failed: string[] = [];
    // One at a time, so a provider hiccup stops at one item instead of failing all of them at once.
    for (const [i, e] of b.items.entries()) {
      const err = await b.run(e);
      if (err) failed.push(err);
      setProgress({ done: i + 1, total: b.items.length, failed });
    }
    if (!failed.length) {
      setOpen(null);
      setProgress(null);
    }
  }

  return (
    <div className="mb-3 rounded-2xl border border-line bg-white p-3">
      <p className="px-1 text-xs text-ink-500">Same kind of thing, more than once. Do them together:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {batches.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-expanded={open === b.key}
            onClick={() => {
              setOpen(open === b.key ? null : b.key);
              setProgress(null);
            }}
            className="flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-800 hover:border-ink-950"
          >
            {b.key === "notes" ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} {b.verb}: {b.label}
            <ChevronDown className="h-3 w-3 text-ink-400" />
          </button>
        ))}
      </div>
      {current && (
        <div className="mt-3 rounded-xl bg-ink-50 p-3">
          <ul className="flex flex-col gap-1.5 text-xs text-ink-700">
            {current.items.slice(0, 6).map((e) => (
              <li key={e.id} className="truncate">
                · {e.draft ? `To ${e.draft.toName ?? e.draft.to}: ${e.draft.subject ?? e.reason}` : e.reason}
              </li>
            ))}
            {current.items.length > 6 && <li className="text-ink-500">and {current.items.length - 6} more</li>}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!!progress && progress.done < progress.total} onClick={() => void runAll(current)}>
              {progress && progress.done < progress.total ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {progress && progress.done < progress.total ? `${progress.done} of ${progress.total}…` : `${current.verb} (${current.items.length})`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            {progress && progress.failed.length > 0 && (
              <span className="text-xs text-[var(--accent-danger)]">
                {progress.failed.length} didn&apos;t go: {progress.failed[0]}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── The list ───────────────────────────────────────────────────────────────────────────────────────────────────────

const enter = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, transition: { duration: 0.16 } } };

function toneOf(e: Escalation): AttentionTone {
  if (e.status === "with_support") return "info";
  if (e.complexity === "critical") return "urgent";
  if (e.complexity === "routine" && e.recommendedAction === "approve" && NOTE_LABELS.has((e.recommendedLabel ?? "").toLowerCase())) return "info";
  return "waiting";
}

export function NeedsYouList() {
  const { listed, pendingTimeOff, lumperAsks, driversAtRisk, offerGroups, count, urgent, any } = useNeedsYou();
  const loads = useCarrierLoads();
  const truckMap = useTruckMap();
  const driverMap = useDriverMap();
  const signedIn = useStore((s) => s.session.mode !== "demo");
  const resolveEscalation = useStore((s) => s.actions.resolveEscalation);
  const routeEscalationToSupport = useStore((s) => s.actions.routeEscalationToSupport);
  const respondTimeOff = useStore((s) => s.actions.respondTimeOff);
  const setAutoChain = useStore((s) => s.actions.setAutoChain);
  const later = useLater();
  // Swiped, counting down to happen (with Undo): off the list meanwhile.
  const pendingSwipes = usePending();
  const waiting = new Set(pendingSwipes.map((p) => p.id));
  const [showLater, setShowLater] = useState(false);
  const batches = useBatches(listed, signedIn);
  if (!any) return null;

  // Most urgent first: decisions now, then what's waiting, then notes.
  const rank: Record<AttentionTone, number> = { urgent: 0, waiting: 1, info: 2, done: 3 };
  const sorted = [...listed].sort((a, b) => rank[toneOf(a)] - rank[toneOf(b)]);
  const now = sorted.filter((e) => !later.has(e.id) && !waiting.has(e.id));
  const setAside = sorted.filter((e) => later.has(e.id));

  function card(e: Escalation) {
    const load = loads.find((l) => l.id === e.loadId);
    const truck = load?.truckId ? truckMap.get(load.truckId) : undefined;
    const driver = truck?.driverId ? driverMap.get(truck.driverId) : undefined;
    const oneMove = e.status === "open" && e.complexity === "routine" && !!e.recommendedAction && !!e.recommendedLabel && !e.draft && !e.suggestRule && !e.portalTaskId;
    return (
      <motion.div key={e.id} layout {...enter}>
        <SwipeAction
          onRight={
            oneMove
              ? () => {
                  if (e.recommendedAction === "approve") celebrate("approve");
                  queueWithUndo(e.id, e.recommendedLabel ?? "Done", () => resolveEscalation(e.id, e.recommendedAction === "approve"));
                }
              : undefined
          }
          rightLabel={e.recommendedLabel}
          onLeft={later.has(e.id) ? undefined : () => setLater([...later, e.id])}
        >
          <AttentionCard tone={toneOf(e)}>
            {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} className="mb-2" />}
            <SourceTag source={e.source} />
            <p className="text-sm leading-relaxed text-ink-800">{e.reason}</p>
            {e.suggestRule && signedIn ? (
              <RuleSuggestion escalation={e} />
            ) : e.portalTaskId && signedIn && e.status === "open" ? (
              <PortalApproval escalation={e} />
            ) : e.draft && !(signedIn && e.status === "with_support") ? (
              <DraftApproval escalation={e} />
            ) : signedIn && e.status === "with_support" ? (
              // A real account: Backroute's support team has it. The owner can still step in on an emergency.
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                  <LifeBuoy className="h-3.5 w-3.5" /> Backroute support is on it. Nothing needed from you.
                </p>
                {e.complexity === "critical" && driver && (
                  <Button size="sm" variant="outline" href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone className="h-3.5 w-3.5" /> Call {driver.name.split(" ")[0]}
                  </Button>
                )}
              </div>
            ) : signedIn && e.complexity === "critical" ? (
              // A real account: no simulated support desk. The owner calls the driver and closes it out.
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {driver && (
                  <Button size="sm" variant="primary" href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone className="h-3.5 w-3.5" /> Call {driver.name.split(" ")[0]}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    celebrate("approve");
                    resolveEscalation(e.id, true);
                  }}
                >
                  <Check className="h-3.5 w-3.5" /> I&apos;ve handled it
                </Button>
              </div>
            ) : e.status === "with_support" ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <LifeBuoy className="h-3.5 w-3.5 animate-pulse" /> Backroute Support is reviewing this. You&apos;ll be notified.
              </p>
            ) : e.complexity === "routine" && e.recommendedAction && e.recommendedLabel ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (e.recommendedAction === "approve") celebrate("approve");
                    else haptic("tap");
                    resolveEscalation(e.id, e.recommendedAction === "approve");
                  }}
                >
                  <Check className="h-3.5 w-3.5" /> {e.recommendedLabel}
                </Button>
                {e.loadId && (
                  <Link href={`/carrier/loads/${e.loadId}`} className="text-xs font-medium text-ink-500 hover:underline">
                    Review manually
                  </Link>
                )}
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => routeEscalationToSupport(e.id)}>
                  <LifeBuoy className="h-3.5 w-3.5" /> Ask a person
                </Button>
                {e.loadId && (
                  <Link href={`/carrier/loads/${e.loadId}`} className="text-xs font-medium text-ink-500 hover:underline">
                    Review load →
                  </Link>
                )}
              </div>
            )}
          </AttentionCard>
        </SwipeAction>
      </motion.div>
    );
  }

  return (
    <section id="needs-you" aria-labelledby="needs-you-title">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-[var(--accent-warn)]" />
        <h2 id="needs-you-title" className="t-section text-ink-950">
          Needs you
        </h2>
        {count > 0 && <Badge tone={urgent ? "danger" : "warning"}>{count}</Badge>}
        <span className="ml-auto hidden text-xs text-ink-400 [@media(pointer:coarse)]:inline">Swipe right to do it, left for later</span>
      </div>
      <BatchBar batches={batches} />
      <div className="grid gap-3 md:grid-cols-2">
        <AnimatePresence initial={false} mode="popLayout">
          {/* Red first, whatever kind it is: a driver at a dock waiting on money, then decisions only the owner can make. */}
          {lumperAsks.map((e) => (
            <motion.div key={e.id} layout {...enter}>
              <LumperAsk ask={e} driverName={driverMap.get(e.driverId)?.name ?? "Driver"} loadRef={loads.find((l) => l.id === e.loadId)?.referenceNumber} />
            </motion.div>
          ))}

          {now.filter((e) => toneOf(e) === "urgent").map(card)}

          {offerGroups.map(([groupId, group]) => {
            const truck = group[0]?.truckId ? truckMap.get(group[0].truckId) : undefined;
            const driver = truck?.driverId ? driverMap.get(truck.driverId) : undefined;
            return (
              <motion.div key={groupId} layout {...enter}>
                <AttentionCard tone="waiting">
                  {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} className="mb-2" />}
                  <p className="text-sm font-semibold text-ink-950">Pick {driver ? `${driver.name.split(" ")[0]}'s` : "the"} next load</p>
                  <p className="mt-0.5 text-xs text-ink-600">
                    {signedIn
                      ? `${group.length} load${group.length === 1 ? "" : "s"} from broker emails fit${group.length === 1 ? "s" : ""}. Pick one and Backroute asks the broker to book it.`
                      : `${group.length} options, best pays ${formatCurrency(Math.max(...group.map((l) => l.netProfit ?? 0)))} after costs.`}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button href="#next-load" size="sm">
                      Choose <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    {truck && !signedIn && (
                      <Button size="sm" variant="outline" onClick={() => setAutoChain(truck.id, true)}>
                        Pick for me
                      </Button>
                    )}
                  </div>
                </AttentionCard>
              </motion.div>
            );
          })}

          {now.filter((e) => toneOf(e) !== "urgent").map(card)}

          {driversAtRisk.map(({ driver, view }) => (
            <motion.div key={driver.id} layout {...enter}>
              <AttentionCard tone="waiting">
                <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                  <UserRound className="h-4 w-4 text-ink-400" /> Check in with {driver.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-600">{view.signals.slice(0, 2).map((s) => s.text).join(" · ")}</p>
                <div className="mt-3">
                  <Button size="sm" variant="primary" href="/carrier/fleet#retention">
                    See what to do
                  </Button>
                </div>
              </AttentionCard>
            </motion.div>
          ))}

          {pendingTimeOff.map((r) => {
            const requester = driverMap.get(r.driverId);
            return (
              <motion.div key={r.id} layout {...enter}>
                <AttentionCard tone="waiting">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                    <CalendarClock className="h-4 w-4 text-ink-400" /> Time off: {requester?.name ?? "Driver"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {formatDate(r.startDate)} – {formatDate(r.endDate)} · {r.reason}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        celebrate("approve");
                        respondTimeOff(r.id, true);
                      }}
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => respondTimeOff(r.id, false)}>
                      <X className="h-3.5 w-3.5" /> Deny
                    </Button>
                  </div>
                </AttentionCard>
              </motion.div>
            );
          })}

          {showLater && setAside.map(card)}
        </AnimatePresence>
      </div>
      {setAside.length > 0 && (
        <button type="button" onClick={() => setShowLater((v) => !v)} className="mt-3 text-xs font-medium text-ink-500 hover:text-ink-950">
          {showLater ? "Hide" : "Show"} {setAside.length} set aside for later
        </button>
      )}
      <div aria-live="polite" className="hide-when-driving pointer-events-none fixed inset-x-0 bottom-[5.5rem] z-[65] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        <AnimatePresence>
          {pendingSwipes.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              className="pointer-events-auto flex items-center gap-4 rounded-full bg-ink-950 py-2 pl-4 pr-2 text-sm text-white shadow-xl"
            >
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4" /> {p.label}
              </span>
              <button type="button" onClick={() => undo(p.id)} className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25">
                Undo
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
