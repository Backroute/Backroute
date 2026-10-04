/** The demo's AI phone calls to drivers: ringing, answering, the back-and-forth, and ending them. */
import { PRIMARY_CARRIER_ID, PRIMARY_DRIVER_ID } from "../mock-data";
import { resolveLoadOffer } from "../engine";
import { legMiles, legProgress } from "../trip-geo";
import { pack } from "../lang";
import { briefCall, CALL_GAP_MS, KIND_LABEL, lateCall, driverLang, lateOnThisLoad, type EmptyAt, type Turn, nextLoadCall, openCall, parkingCall, quietReason, respond, RING_MS, stillRelevant, textCopyFor } from "../dispatch-calls";
import type { ActivityEvent, Broker, DispatchCall, DispatchCallKind, Driver, DriverMessage, Lang, Translations, Escalation, Incident, Load, Truck, VoiceCall } from "../types";
import { readLangOf } from "./settings";
import type { StoreState } from "./state";
import { openIncident, uid } from "./support";

// ——— AI dispatch calls ———

/** Everything a call can touch, gathered so the tick and the driver's own taps change it the same way. */
export interface CallDraft {
  brokers: Broker[];
  incidents: Incident[];
  loads: Load[];
  trucks: Truck[];
  drivers: Driver[];
  escalations: Escalation[];
  driverMessages: DriverMessage[];
  dispatchCalls: DispatchCall[];
  events: ActivityEvent[];
  /** The language the owner reads calls in on the dashboard. */
  readLang: Lang;
  /** Owner-operator: there's no office to call back, so a driver asking for a person gets Backroute Support. */
  solo: boolean;
  /** Signed in to a real account: every driver is a real person, so nobody picks up a call on their own. */
  live: boolean;
}

export function draftFrom(state: StoreState): CallDraft {
  const { brokers, incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls } = state;
  return { brokers, incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls, events: [], readLang: readLangOf(state.settings), solo: state.settings.ownerOperator, live: state.session.mode !== "demo" };
}

export function callDraftResult(d: CallDraft) {
  const { incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls } = d;
  return { incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls };
}

export function patchCall(d: CallDraft, id: string, patch: Partial<DispatchCall>) {
  d.dispatchCalls = d.dispatchCalls.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

export function textDriver(d: CallDraft, driverId: string, content: string) {
  d.driverMessages = [...d.driverMessages, { id: uid("dm"), driverId, from: "ai", content, timestamp: new Date().toISOString() }];
}

export function callEvent(d: CallDraft, call: DispatchCall, message: string, detail: string, severity: ActivityEvent["severity"] = "info") {
  d.events.push({ id: uid("act"), timestamp: new Date().toISOString(), type: "check_call", channel: "voice", message, detail, loadId: call.loadId, carrierId: call.carrierId, severity });
}

/** The call can't happen (held, missed, declined): the driver gets the same information by text, once. */
export function textInstead(d: CallDraft, call: DispatchCall) {
  if (call.textedAt) return;
  textDriver(d, call.driverId, textCopyFor(call));
  patchCall(d, call.id, { textedAt: new Date().toISOString() });
}

export function ringCall(d: CallDraft, call: DispatchCall) {
  const driver = d.drivers.find((x) => x.id === call.driverId);
  // A call that waited (sleeper, quiet hours) rings in the language the driver talks in now, not when it was queued.
  patchCall(d, call.id, { status: "ringing", ringingAt: new Date().toISOString(), channel: driver?.prefs?.reach ?? "app", lang: driverLang(driver) });
}

/** Who reads this call in a language other than the one it's spoken in: the owner on the dashboard, and the driver
 *  when their app is in a different language than they talk in. */
export function readersOf(d: CallDraft, call: DispatchCall): Lang[] {
  const appLang = d.drivers.find((x) => x.id === call.driverId)?.prefs?.appLanguage ?? "en";
  return Array.from(new Set([d.readLang, appLang])).filter((l) => l !== call.lang);
}

/** The same words in each reader's language, or undefined when everyone reads the spoken language. */
export function trFor(langs: Lang[], words: (lang: Lang) => string | undefined): Translations | undefined {
  if (!langs.length) return undefined;
  const tr: Translations = {};
  for (const l of langs) {
    const w = words(l);
    if (w) tr[l] = w;
  }
  return tr;
}

/** A turn said in the call's language, carrying each reader's version of the line and of every button. */
export function translated(langs: Lang[], turn: Turn, inLang: (lang: Lang) => Turn) {
  const others = new Map(langs.map((l) => [l, inLang(l)] as const));
  return {
    ...turn,
    tr: trFor(langs, (l) => others.get(l)?.say),
    choices: turn.choices.map((ch, i) => ({ ...ch, tr: trFor(langs, (l) => others.get(l)?.choices[i]?.label) })),
  };
}

/** The AI's opening line, said in the driver's language and kept in every reader's. */
export function openingFor(d: CallDraft, call: DispatchCall) {
  return translated(readersOf(d, call), openCall(call), (l) => openCall(call, l));
}

export function answerCall(d: CallDraft, call: DispatchCall) {
  const turn = openingFor(d, call);
  const now = new Date().toISOString();
  patchCall(d, call.id, { status: "live", answeredAt: now, lines: [{ speaker: "ai", text: turn.say, at: now, tr: turn.tr }], choices: turn.choices, step: turn.step });
}

/** One back-and-forth on a live call. `heard` is what the driver actually said, when they spoke instead of tapping. */
export function replyToCall(d: CallDraft, callId: string, reply: string, heard?: string) {
  const call = d.dispatchCalls.find((c) => c.id === callId);
  if (!call || call.status !== "live") return;
  const L = pack(call.lang);
  const readers = readersOf(d, call);
  const choice = call.choices.find((ch) => ch.reply === reply);
  const said = heard ?? (reply === "again" ? L.saidAgain : reply === "person" ? L.saidPerson : choice?.say ?? reply);
  // What the driver said, for readers of other languages: the button's own translation when there is one. Words
  // the driver actually spoke stay as spoken; translating free speech needs the real voice AI.
  const saidTr = heard
    ? undefined
    : trFor(readers, (l) => (reply === "again" ? pack(l).saidAgain : reply === "person" ? pack(l).saidPerson : choice?.tr?.[l]));
  const now = new Date().toISOString();

  // The owner has the call now: the AI only listens and keeps the record.
  if (call.ownerTookOver) {
    patchCall(d, callId, { lines: [...call.lines, { speaker: "driver", text: said, at: now, tr: saidTr }] });
    return;
  }

  let turn = translated(readers, respond(call, reply), (l) => respond(call, reply, l));
  const toSupport = d.solo && (d.live || call.driverId === PRIMARY_DRIVER_ID) && !!turn.report?.person;
  if (toSupport && reply === "person") turn = { ...turn, say: L.personSupport, tr: trFor(readers, (l) => pack(l).personSupport) };
  patchCall(d, callId, {
    lines: [...call.lines, { speaker: "driver", text: said, at: now, tr: saidTr }, { speaker: "ai", text: turn.say, at: now, tr: turn.tr }],
    choices: turn.choices,
    step: turn.step,
    ...(turn.effects ? { effects: turn.effects } : {}),
    ...(turn.outcome !== undefined ? { outcome: turn.outcome } : {}),
    ...(turn.facts ? { facts: { ...call.facts, ...turn.facts } } : {}),
  });
  const driver = d.drivers.find((x) => x.id === call.driverId);
  const first = driver?.name.split(" ")[0] ?? "Driver";
  // A breakdown or a late truck is worked the moment it's said, not when the driver hangs up.
  if (turn.report?.incident && driver) {
    const { incident, event } = openIncident(d, driver.id, driver.truckId, turn.report.incident.type, turn.report.incident.note);
    d.incidents = [incident, ...d.incidents];
    d.events.push(event);
  }
  if (turn.report?.person) {
    const esc: Escalation = {
      id: uid("esc"), loadId: call.loadId ?? "", carrierId: call.carrierId,
      reason: toSupport
        ? `${turn.report.person} on an AI call (${KIND_LABEL[call.kind].toLowerCase()}). Backroute Support is calling back.`
        : `${turn.report.person} on an AI call (${KIND_LABEL[call.kind].toLowerCase()}). Call them back at ${driver?.phone ?? "their number"}.`,
      createdAt: now, status: toSupport ? "with_support" : "open", complexity: "routine",
      recommendedAction: "approve", recommendedLabel: `Called ${first} back`,
    };
    d.escalations = [esc, ...d.escalations];
    d.events.push({ id: uid("act"), timestamp: now, type: "escalation", message: `${first} wants a person on the phone`, detail: esc.reason, loadId: call.loadId, carrierId: call.carrierId, severity: "warning" });
  }
  if (turn.end) endCall(d, callId);
}

/** Hang up: whatever was agreed happens now, the load keeps a recording, and the driver gets a text copy. */
export function endCall(d: CallDraft, callId: string) {
  const call = d.dispatchCalls.find((c) => c.id === callId);
  if (!call || (call.status !== "live" && call.status !== "ringing")) return;
  const now = new Date().toISOString();
  const driver = d.drivers.find((x) => x.id === call.driverId);
  const first = driver?.name.split(" ")[0] ?? "the driver";

  for (const effect of call.effects) {
    if (effect.type === "book") {
      if (!d.loads.some((l) => l.id === effect.loadId && l.stage === "offered")) continue;
      const resolved = resolveLoadOffer(d.loads, effect.groupId, effect.loadId, "driver");
      d.loads = resolved.loads;
      const chosen = d.loads.find((l) => l.id === effect.loadId);
      if (chosen?.truckId) d.trucks = d.trucks.map((t) => (t.id === chosen.truckId && t.currentLoadId ? { ...t, nextLoadId: chosen.id } : t));
      d.events.push(...resolved.events);
    } else if (effect.type === "reserve_parking") {
      callEvent(d, call, `AI reserved parking for ${first}`, `${effect.place} · $${effect.cost} on the fleet card`, "success");
    } else if (effect.type === "prefs") {
      d.drivers = d.drivers.map((x) => (x.id === call.driverId ? { ...x, prefs: { ...x.prefs, ...effect.prefs } } : x));
    }
  }

  const answered = call.status === "live";
  const outcome = call.outcome ?? (answered ? "Driver hung up" : undefined);
  patchCall(d, callId, { status: "done", endedAt: now, choices: [], outcome });
  // A copy of anything with a number in it — unless the same text already went out while the call was held.
  if (answered && (!call.textedAt || call.effects.length)) {
    textDriver(d, call.driverId, textCopyFor(call));
    patchCall(d, callId, { textedAt: now });
  }

  // A load call is kept on the load that got booked; the others on the load they were about.
  const booked = call.effects.find((e) => e.type === "book");
  const recordOn = call.kind === "next_load" ? (booked?.type === "book" ? booked.loadId : undefined) : call.loadId;
  if (answered && recordOn && call.lines.length) {
    const startedAt = call.answeredAt ?? call.createdAt;
    const record: VoiceCall = {
      id: uid("call"), title: `AI dispatch call with ${first} · ${KIND_LABEL[call.kind]}`, status: "completed", startedAt,
      durationSec: Math.max(12, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
      transcript: call.lines.map((l) => ({ speaker: l.speaker === "owner" ? "carrier" : l.speaker, text: l.text })), outcome,
    };
    d.loads = d.loads.map((l) => (l.id === recordOn ? { ...l, calls: [...l.calls, record] } : l));
  }
  if (answered) callEvent(d, call, `AI called ${first}: ${KIND_LABEL[call.kind].toLowerCase()}`, outcome ?? "Call ended");
}

/** The calls the AI decides to make this tick, then who's ringing, held, missed or talking. */
export function runDispatchCalls(d: CallDraft, newOfferBatches: { truckId: string; offers: Load[]; emptyAt: EmptyAt }[]) {
  const now = new Date();
  const nowMs = now.getTime();
  const has = (driverId: string, kind: DispatchCallKind, loadId?: string) => d.dispatchCalls.some((c) => c.driverId === driverId && c.kind === kind && c.loadId === loadId);
  const queue = (call: DispatchCall | null) => {
    if (call) d.dispatchCalls = [call, ...d.dispatchCalls].slice(0, 60);
  };

  // New options for a truck the driver picks for: a call, or a text if that's what the driver asked for.
  for (const batch of newOfferBatches) {
    const truck = d.trucks.find((t) => t.id === batch.truckId);
    const driver = d.drivers.find((x) => x.id === truck?.driverId);
    if (!truck || !driver) continue;
    const call = nextLoadCall(driver, batch.offers, batch.emptyAt, !!truck.secondDriverId);
    if (!call) continue;
    if (driver.prefs?.newLoads === "text") textDriver(d, driver.id, textCopyFor(call));
    else queue(call);
  }

  // The calls a dispatcher makes while a load is moving.
  for (const truck of d.trucks) {
    const driver = d.drivers.find((x) => x.id === truck.driverId);
    const load = d.loads.find((l) => l.id === truck.currentLoadId);
    if (!driver || !load || driver.carrierId !== PRIMARY_CARRIER_ID) continue;
    const p = legProgress(load, nowMs);
    // Briefs come about an hour out, the way a dispatcher calls before the gate — not at the start of a long run.
    const near = (leg: "pickup" | "delivery") => legMiles(load, leg) * (1 - p) <= 60 || p >= 0.9;
    if (load.stage === "dispatched" && (p >= 0.45 || near("pickup")) && !has(driver.id, "pickup_brief", load.id)) queue(briefCall(driver, load, "pickup", p));
    if (load.stage !== "in_transit") continue;
    const milesLeft = load.lane.miles * (1 - p);
    const longRun = driver.runType === "otr" || driver.runType === "regional";
    if (longRun && p >= 0.12 && p < 0.6 && milesLeft / 50 > driver.hoursRemaining && !has(driver.id, "hours_parking", load.id)) {
      const { call, newWindow } = parkingCall(driver, load, milesLeft);
      d.loads = d.loads.map((l) => (l.id === load.id ? { ...l, deliveryWindow: newWindow } : l));
      callEvent(d, call, `AI moved ${driver.name.split(" ")[0]}'s delivery to tomorrow`, `${load.lane.destination} · out of drive hours before the receiver, broker told`, "warning");
      queue(call);
    } else if (p >= 0.25 && p < 0.55 && lateOnThisLoad(load.id) && !has(driver.id, "late_eta", load.id) && !has(driver.id, "hours_parking", load.id)) {
      const { call, newWindow } = lateCall(driver, load);
      d.loads = d.loads.map((l) => (l.id === load.id ? { ...l, deliveryWindow: newWindow } : l));
      callEvent(d, call, "AI moved a delivery appointment", `${load.lane.destination} · ${call.facts.road} wreck, ${newWindow.toLowerCase()}, receiver and broker told`, "warning");
      queue(call);
    }
    if (near("delivery") && !has(driver.id, "delivery_brief", load.id)) queue(briefCall(driver, load, "delivery", p));
  }

  // Calls that stopped mattering (the stop was reached, the load was picked in the app) never ring.
  for (const call of d.dispatchCalls) {
    if ((call.status === "queued" || call.status === "held" || call.status === "ringing") && !stillRelevant(call, d.loads)) {
      patchCall(d, call.id, { status: "dropped", endedAt: now.toISOString(), outcome: "Not needed anymore", choices: [] });
    }
  }

  for (const driver of d.drivers) {
    const mine = d.dispatchCalls.filter((c) => c.driverId === driver.id);
    const active = mine.find((c) => c.status === "ringing" || c.status === "live");
    const primary = d.live || driver.id === PRIMARY_DRIVER_ID;

    if (active?.status === "ringing") {
      const ringingFor = nowMs - Date.parse(active.ringingAt ?? active.createdAt);
      // Other drivers in the demo pick up on their own, so the carrier sees calls play out across the fleet.
      if (!primary && ringingFor > 6000) answerCall(d, active);
      else if (ringingFor > RING_MS) {
        patchCall(d, active.id, { status: "missed", endedAt: now.toISOString(), outcome: "No answer. Texted instead", choices: [] });
        textInstead(d, active);
        callEvent(d, active, `${driver.name.split(" ")[0]} missed an AI call`, `${KIND_LABEL[active.kind]} · sent by text instead`);
      }
      continue;
    }
    if (active?.status === "live") {
      if (primary) continue;
      const last = active.lines.at(-1);
      if (active.ownerTookOver) {
        // Talking with the owner now: the driver answers them, and the owner hangs up when they're done.
        if (last?.speaker === "owner" && nowMs - Date.parse(last.at) > 3000) replyToCall(d, active.id, "ack");
        continue;
      }
      if (last && nowMs - Date.parse(last.at) > 4000) {
        // A driver who takes the call the ordinary way: yes to the load or the parking spot, then "got it".
        const choice = ["book:0", "reserve", "bye"].map((r) => active.choices.find((ch) => ch.reply === r)).find(Boolean) ?? active.choices.at(-1);
        if (choice) replyToCall(d, active.id, choice.reply);
        else endCall(d, active.id);
      }
      continue;
    }

    const waiting = mine.filter((c) => c.status === "queued" || c.status === "held").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (!waiting.length) continue;
    const lastEnded = Math.max(0, ...mine.filter((c) => c.endedAt && c.status !== "dropped").map((c) => Date.parse(c.endedAt!)));
    const quiet = quietReason(driver, now);
    for (const call of waiting) {
      if (quiet) {
        if (call.status !== "held") {
          patchCall(d, call.id, { status: "held", heldReason: quiet });
          textInstead(d, call);
          callEvent(d, call, `AI held a call to ${driver.name.split(" ")[0]}`, `${quiet}. Texted instead, will call if it still matters later`);
        }
      } else if (call.status === "held") patchCall(d, call.id, { status: "queued", heldReason: undefined });
    }
    if (!quiet && nowMs - lastEnded > CALL_GAP_MS) ringCall(d, waiting[0]);
  }
}
