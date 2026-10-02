import { create } from "zustand";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./client";
import type { Membership } from "./account";
import { useStore } from "../store";
import { PRIMARY_CARRIER_ID } from "../mock-data";
import { switchToRealDockClock } from "../detention";
import { setLocator } from "../trip-geo";
import { conflictKey, CREATED_ONLY, rowFor, type Item, type RecordKind, type Table } from "./rows";

/**
 * Saving and loading a carrier's data, and keeping every signed-in screen in step.
 *
 * Phase 1: the AI still runs in the browser, in the office's session (owner or dispatcher). That session loads the
 * carrier's rows into the app, saves what changes every couple of seconds, and hears what drivers change. A driver's
 * phone loads only what the access rules let it see, and saves only what a driver may change. Last write wins.
 * Phase 2 moves the AI to the server so it runs with every screen closed.
 */

type State = ReturnType<typeof useStore.getState>;
type Slice =
  | "drivers"
  | "trucks"
  | "loads"
  | "escalations"
  | "dispatchCalls"
  | "driverMessages"
  | "activity"
  | "incidents"
  | "maintenanceAppointments"
  | "dvirInspections"
  | "timeOffRequests"
  | "expenses"
  | "carrierMessages"
  | "brokers"
  | "fuelTx"
  | "tollTx"
  | "payRuns"
  | "advances";

interface Spec {
  slice: Slice;
  table: Table;
  kind?: RecordKind;
  /** Items in the app that belong to this carrier (the demo world also holds other carriers' loads for Ops). */
  mine?: (item: Item) => boolean;
  /** When the item happened, for ordering what comes back. */
  time: (item: Item) => string;
  newestFirst: boolean;
  /** What a driver's phone may write: change rows it can see, add and change its own, only add, or nothing. */
  driver: "update" | "upsert" | "insert" | null;
  /** A driver's phone loads it without being able to change it (their truck). */
  driverReads?: boolean;
  /** Logs that only grow: load the newest this many. */
  limit?: number;
  /** A bookkeeper's session reads it, and writes it too when "write". */
  books?: "read" | "write";
}

const ours = (i: Item) => i.carrierId === PRIMARY_CARRIER_ID;
const at = (k: string) => (i: Item) => String(i[k] ?? "");
const none = () => "";

const SPECS: Spec[] = [
  { slice: "drivers", table: "drivers", time: none, newestFirst: false, driver: "update", books: "read" },
  { slice: "trucks", table: "trucks", time: none, newestFirst: false, driver: null, driverReads: true, books: "read" },
  { slice: "loads", table: "loads", mine: ours, time: at("createdAt"), newestFirst: true, driver: "update", books: "read" },
  { slice: "escalations", table: "escalations", mine: ours, time: at("createdAt"), newestFirst: true, driver: null },
  { slice: "dispatchCalls", table: "dispatch_calls", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "driverMessages", table: "driver_messages", time: at("timestamp"), newestFirst: false, driver: "insert", limit: 500 },
  { slice: "activity", table: "activity", mine: (i) => !i.carrierId || ours(i), time: at("timestamp"), newestFirst: true, driver: null, limit: 80 },
  { slice: "incidents", table: "records", kind: "incident", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "maintenanceAppointments", table: "records", kind: "maintenance", time: at("createdAt"), newestFirst: true, driver: null },
  { slice: "dvirInspections", table: "records", kind: "dvir", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "timeOffRequests", table: "records", kind: "time_off", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "expenses", table: "records", kind: "expense", time: at("createdAt"), newestFirst: true, driver: "upsert", books: "write" },
  { slice: "carrierMessages", table: "records", kind: "carrier_message", time: at("timestamp"), newestFirst: false, driver: null, limit: 300 },
  // Brokers the carrier added with a load; the sample brokers stay in the app only.
  { slice: "brokers", table: "records", kind: "broker", mine: ours, time: none, newestFirst: false, driver: null, driverReads: true, books: "read" },
  // The back office (lib/back-office): fuel and tolls, pay runs and advances. Drivers read their own pay.
  { slice: "fuelTx", table: "records", kind: "fuel", time: at("date"), newestFirst: true, driver: null, books: "write" },
  { slice: "tollTx", table: "records", kind: "toll", time: at("date"), newestFirst: true, driver: null, books: "write" },
  { slice: "payRuns", table: "records", kind: "pay_run", time: at("period"), newestFirst: true, driver: null, driverReads: true, books: "write" },
  { slice: "advances", table: "records", kind: "advance", time: at("at"), newestFirst: true, driver: null, driverReads: true, books: "write" },
];

const driverSees = (s: Spec) => s.driver !== null || !!s.driverReads;
/** What a session loads: the office everything, a driver their own things, a bookkeeper the books and the fleet. */
const sees = (mode: Connection["mode"], s: Spec) => (mode === "office" ? true : mode === "books" ? !!s.books : driverSees(s));
/** How a session saves a list, if at all. */
const writes = (mode: Connection["mode"], s: Spec): "update" | "upsert" | "insert" | null =>
  mode === "office" ? "upsert" : mode === "books" ? (s.books === "write" ? "upsert" : null) : s.driver;
const specKey = (s: Spec) => `${s.table}/${s.kind ?? ""}`;
const conflictOf = (s: Spec) => conflictKey(s.kind);

/** JSON with sorted keys: Postgres stores jsonb in its own key order, so plain JSON.stringify can't compare. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

// ─── Status, for the small "not saved" notice ────────────────────────────────

/** "cached": showing what this phone saved last time, while the latest loads. */
export type SyncState = "saved" | "saving" | "offline" | "cached";
export const useSyncStatus = create<{ state: SyncState; savedAt: number | null }>(() => ({ state: "saved", savedAt: null }));

// ─── Connection ──────────────────────────────────────────────────────────────

interface Connection {
  carrierId: string;
  /** Who's signed in, for the view kept on this device, and when it was last kept. */
  userId?: string;
  viewAt?: number;
  mode: "office" | "driver" | "books";
  /** What the database holds for each item, as far as this browser knows: the object last saved or loaded. */
  last: Map<string, { ref: unknown; json: string }>;
  /** Ids per table, to notice deletions. */
  known: Map<string, Set<string>>;
  /** Versions this browser just wrote, so their echo from Realtime isn't applied back on top of newer changes. */
  sent: Map<string, string[]>;
  settingsJson: string;
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
  flushing: boolean;
  unsubscribe: () => void;
  channel: RealtimeChannel | null;
}

let conn: Connection | null = null;

const MERGED = new Set(["loads", "trucks", "drivers", "escalations"]);

const itemKey = (s: Spec, id: string) => `${specKey(s)}/${id}`;

/**
 * The fields of a load this screen changed since it last had it (added, edited or removed), for the database to merge
 * into the current row instead of replacing it (supabase/migrations/20261001000000_merge_edits.sql). Null for a load
 * this screen never had: that one goes in whole.
 */
export function changedFields(baseJson: string | undefined, item: Item): string[] | null {
  if (!baseJson) return null;
  let base: Record<string, unknown>;
  try {
    base = JSON.parse(baseJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const keys = new Set([...Object.keys(base), ...Object.keys(item).filter((k) => (item as Record<string, unknown>)[k] !== undefined)]);
  return [...keys].filter((k) => stable((item as Record<string, unknown>)[k]) !== stable(base[k]));
}

/** The settings keys that changed since `baseJson` (a removed key is sent as null, and the database drops it). */
export function settingsPatch(baseJson: string, now: Record<string, unknown>): Record<string, unknown> {
  let base: Record<string, unknown> = {};
  try {
    base = baseJson ? (JSON.parse(baseJson) as Record<string, unknown>) : {};
  } catch {
    base = {};
  }
  const patch: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(now)])) {
    const v = now[k];
    if (stable(v) !== stable(base[k])) patch[k] = v === undefined ? null : v;
  }
  return patch;
}

function remember(c: Connection, s: Spec, item: Item, json = stable(item)) {
  c.last.set(itemKey(s, item.id), { ref: item, json });
  let ids = c.known.get(specKey(s));
  if (!ids) c.known.set(specKey(s), (ids = new Set()));
  ids.add(item.id);
}

async function selectAll(s: Spec, carrierId: string): Promise<Item[]> {
  const db = supabase();
  const out: Item[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = db.from(s.table).select("data").eq("carrier_id", carrierId);
    if (s.kind) q = q.eq("kind", s.kind);
    if (s.limit) q = q.order(CREATED_ONLY.has(s.table) ? "created_at" : "updated_at", { ascending: false });
    const to = s.limit ? Math.min(from + page, s.limit) - 1 : from + page - 1;
    const { data, error } = await q.range(from, to);
    if (error) throw error;
    out.push(...(data ?? []).map((r) => r.data as Item));
    if (!data || data.length < to - from + 1 || (s.limit && out.length >= s.limit)) break;
  }
  const sign = s.newestFirst ? -1 : 1;
  return out.sort((a, b) => sign * s.time(a).localeCompare(s.time(b)));
}

/** A driver's account whose fleet isn't set up yet, or whose driver profile was removed. */
export class NotSetUpError extends Error {}

/**
 * Loads the carrier into the app and starts saving. `fresh` is a carrier just created at sign-up: it starts from
 * the fleet in the app and the first save writes all of it.
 */
export async function connect(m: Membership, opts: { fresh?: boolean; userId?: string } = {}) {
  if (conn?.carrierId === m.carrierId) return;
  disconnect();
  const mode = m.role === "driver" ? "driver" : m.role === "bookkeeper" ? "books" : "office";
  const db = supabase();
  const { data: carrier, error } = await db.from("carriers").select("id, name, mc, dot, owner_operator, settings").eq("id", m.carrierId).single();
  if (error) throw error;

  const specs = SPECS.filter((s) => sees(mode, s));
  const loaded = new Map<Slice, Item[]>();
  if (!opts.fresh) {
    const lists = await Promise.all(specs.map((s) => selectAll(s, m.carrierId)));
    specs.forEach((s, n) => loaded.set(s.slice, lists[n]));
  }
  // Only a carrier created a moment ago at sign-up starts from what's in the app. Anything else, even an empty
  // fleet, loads from the database, so sample data never ends up in a real account.
  const fresh = !!opts.fresh;
  if (mode === "driver" && !loaded.get("drivers")?.some((d) => d.id === m.driverId)) throw new NotSetUpError();

  switchToRealDockClock();
  followRealPositions();
  const c: Connection = {
    carrierId: m.carrierId,
    mode,
    last: new Map(),
    known: new Map(),
    sent: new Map(),
    settingsJson: "",
    timer: null,
    failures: 0,
    flushing: false,
    unsubscribe: () => {},
    channel: null,
  };
  conn = c;

  useStore.setState((s) => {
    const next: Partial<State> = {
      session: { mode, carrierId: m.carrierId, driverId: m.driverId, fresh },
      carriers: s.carriers.map((x) =>
        x.id === PRIMARY_CARRIER_ID
          ? { ...x, name: carrier.name, mc: carrier.mc ? `MC-${carrier.mc}` : x.mc, dot: carrier.dot ? `DOT-${carrier.dot}` : x.dot }
          : x,
      ),
      settings: { ...s.settings, ...(fresh ? {} : (carrier.settings as Partial<State["settings"]>)), ownerOperator: carrier.owner_operator },
    };
    if (!fresh) {
      for (const spec of specs) {
        const rows = loaded.get(spec.slice) ?? [];
        const others = spec.mine ? (s[spec.slice] as unknown as Item[]).filter((i) => !spec.mine!(i)) : [];
        (next as Record<string, unknown>)[spec.slice] = spec.newestFirst ? [...rows, ...others] : [...others, ...rows];
      }
      // A driver's phone (or a bookkeeper's screen) holds only what they can see: the rest of the sample world goes.
      if (mode !== "office") for (const spec of SPECS.filter((x) => !sees(mode, x))) (next as Record<string, unknown>)[spec.slice] = spec.mine ? (s[spec.slice] as unknown as Item[]).filter((i) => !spec.mine!(i)) : [];
    }
    return next;
  });

  // What was just loaded is already saved.
  if (!fresh) {
    const s = useStore.getState();
    for (const spec of specs) for (const item of s[spec.slice] as unknown as Item[]) if (!spec.mine || spec.mine(item)) remember(c, spec, item);
    c.settingsJson = stable(s.settings);
  }

  c.unsubscribe = useStore.subscribe(() => schedule(c));
  const onHide = () => document.visibilityState === "hidden" && void flush(c);
  document.addEventListener("visibilitychange", onHide);
  const unsubStore = c.unsubscribe;
  c.unsubscribe = () => {
    unsubStore();
    document.removeEventListener("visibilitychange", onHide);
  };
  c.channel = listen(c, specs);
  if (fresh) schedule(c, 0);
  c.userId = opts.userId;
  saveView(c, true);
  if (useSyncStatus.getState().state === "cached") useSyncStatus.setState({ state: "saved", savedAt: Date.now() });
}

// ─── Opening fast: the last view, kept on this device ────────────────────────

const VIEW_KEY = "backroute.view";
const VIEW_MAX_AGE = 3 * 86400_000;
const VIEW_MAX_CHARS = 2_500_000;

interface View {
  userId: string;
  carrierId: string;
  mode: "office" | "driver" | "books";
  driverId: string | null;
  at: number;
  carrier: { name: string; mc: string; dot: string };
  settings: Partial<State["settings"]>;
  slices: Partial<Record<Slice, Item[]>>;
}

/**
 * What this person last saw, kept in the browser so the app opens at once next time (and still shows the trip with
 * no signal), then catches up from the database. Kept for three days, for the signed-in person only, and forgotten
 * on sign-out.
 */
function saveView(c: Connection, force = false) {
  if (!c.userId || conn !== c || typeof window === "undefined") return;
  // At most every 15 seconds, and whenever the app goes to the background (flush runs then).
  if (!force && c.viewAt && Date.now() - c.viewAt < 15_000 && document.visibilityState !== "hidden") return;
  c.viewAt = Date.now();
  try {
    const s = useStore.getState();
    const specs = SPECS.filter((x) => sees(c.mode, x));
    const cap: Partial<Record<Slice, number>> = { loads: 300, driverMessages: 100, activity: 50, carrierMessages: 100, escalations: 100 };
    const slices: View["slices"] = {};
    for (const spec of specs) {
      let items = (s[spec.slice] as unknown as Item[]).filter((i) => !spec.mine || spec.mine(i));
      if (spec.slice === "loads") items = items.filter((l) => !(l as { imported?: boolean }).imported);
      const n = cap[spec.slice];
      if (n) items = spec.newestFirst ? items.slice(0, n) : items.slice(-n);
      slices[spec.slice] = items;
    }
    const carrier = s.carriers.find((x) => x.id === PRIMARY_CARRIER_ID);
    const view: View = { userId: c.userId, carrierId: c.carrierId, mode: c.mode, driverId: s.session.driverId ?? null, at: Date.now(), carrier: { name: carrier?.name ?? "", mc: carrier?.mc ?? "", dot: carrier?.dot ?? "" }, settings: s.settings, slices };
    const json = JSON.stringify(view);
    if (json.length <= VIEW_MAX_CHARS) window.localStorage.setItem(VIEW_KEY, json);
    else window.localStorage.removeItem(VIEW_KEY);
  } catch {
    // Storage full or blocked (private browsing): the app just opens the usual way.
  }
}

/** The view kept for this person, if it's recent. */
export function cachedView(userId: string): View | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "null") as View | null;
    return v && v.userId === userId && Date.now() - v.at < VIEW_MAX_AGE ? v : null;
  } catch {
    return null;
  }
}

/** Shows a kept view right away, read-only in effect until connect() has the latest (it replaces it all). */
/** A real account's trips move by where the truck really is (its ELD position, fresh within 30 minutes); the sample
 *  fleet a signed-in owner practices on keeps the simulated drive. */
function followRealPositions() {
  setLocator((load) => {
    const s = useStore.getState();
    if (s.session.mode === "demo") return "simulate";
    const pos = s.trucks.find((t) => t.id === load.truckId)?.position;
    return pos && Date.now() - Date.parse(pos.at) < 30 * 60_000 ? pos : null;
  });
}

export function showCached(v: View) {
  followRealPositions();
  useStore.setState((s) => {
    const next: Partial<State> = {
      session: { mode: v.mode, carrierId: v.carrierId, driverId: v.driverId, fresh: false },
      carriers: s.carriers.map((x) => (x.id === PRIMARY_CARRIER_ID ? { ...x, name: v.carrier.name || x.name, mc: v.carrier.mc || x.mc, dot: v.carrier.dot || x.dot } : x)),
      settings: { ...s.settings, ...v.settings },
    };
    for (const spec of SPECS) {
      const rows = v.slices[spec.slice];
      if (!rows) {
        if (v.mode !== "office" && !sees(v.mode, spec)) (next as Record<string, unknown>)[spec.slice] = spec.mine ? (s[spec.slice] as unknown as Item[]).filter((i) => !spec.mine!(i)) : [];
        continue;
      }
      const others = spec.mine ? (s[spec.slice] as unknown as Item[]).filter((i) => !spec.mine!(i)) : [];
      (next as Record<string, unknown>)[spec.slice] = spec.newestFirst ? [...rows, ...others] : [...others, ...rows];
    }
    return next;
  });
  useSyncStatus.setState({ state: "cached" });
}

export function forgetViews() {
  try {
    window.localStorage.removeItem(VIEW_KEY);
  } catch {
    // Nothing kept.
  }
}

export function disconnect() {
  if (!conn) return;
  conn.unsubscribe();
  if (conn.timer) clearTimeout(conn.timer);
  if (conn.channel) void supabase().removeChannel(conn.channel);
  conn = null;
  setLocator(null);
}

/** Signs out and reloads, so the next person on this device starts clean. */
export async function signOut() {
  if (conn) await flush(conn);
  disconnect();
  forgetViews();
  await supabase().auth.signOut();
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

// ─── Saving ──────────────────────────────────────────────────────────────────

function schedule(c: Connection, delay = 2000) {
  if (c.timer || conn !== c) return;
  // After failures, back off up to half a minute.
  const wait = c.failures ? Math.min(30000, 2000 * 2 ** c.failures) : delay;
  c.timer = setTimeout(() => {
    c.timer = null;
    void flush(c);
  }, wait);
}

async function flush(c: Connection) {
  if (c.flushing || conn !== c) return;
  c.flushing = true;
  const s = useStore.getState();
  const db = supabase();
  let failed = false;
  const write = async (p: PromiseLike<{ error: { code?: string; message: string } | null }>, undo: () => void) => {
    const { error } = await p;
    if (!error) return;
    // Refused by the access rules: retrying won't help. Anything else (offline, timeout) is tried again later.
    if (error.code === "42501") console.warn("[backroute] not allowed to save:", error.message);
    else {
      failed = true;
      undo();
    }
  };

  try {
    for (const spec of SPECS) {
      const how = writes(c.mode, spec);
      if (!how) continue;
      const items = (s[spec.slice] as unknown as Item[]).filter((i) => !spec.mine || spec.mine(i));
      const changed: Item[] = [];
      const previous = new Map<string, { ref: unknown; json: string } | undefined>();
      const seen = new Set<string>();
      for (const item of items) {
        seen.add(item.id);
        const key = itemKey(spec, item.id);
        const prev = c.last.get(key);
        if (prev?.ref === item) continue;
        const json = stable(item);
        if (prev?.json === json) {
          prev.ref = item;
          continue;
        }
        previous.set(item.id, prev);
        remember(c, spec, item, json);
        const sent = c.sent.get(key) ?? [];
        c.sent.set(key, [...sent.slice(-4), json]);
        changed.push(item);
      }
      const undo = (list: Item[]) => () => {
        for (const i of list) {
          const p = previous.get(i.id);
          if (p) c.last.set(itemKey(spec, i.id), p);
          else c.last.delete(itemKey(spec, i.id));
        }
      };

      const now = new Date().toISOString();
      const rowOf = (i: Item) => {
        const row = rowFor(spec.table, spec.kind, c.carrierId, i, now);
        // Only what this screen changed, merged into the current row by the database (loads, trucks, drivers and
        // Needs you items; supabase/migrations/20261001000000_merge_edits.sql and 20261006000000_merge_more.sql).
        const changed = MERGED.has(spec.table) ? changedFields(previous.get(i.id)?.json, i) : null;
        return changed ? { ...row, data: { ...row.data, _changed: changed } } : row;
      };
      for (let n = 0; n < changed.length; n += 200) {
        const chunk = changed.slice(n, n + 200);
        if (how === "update") {
          for (const i of chunk) {
            const { id: _id, carrier_id: _c, ...rest } = rowOf(i);
            void _id;
            void _c;
            let q = db.from(spec.table).update(rest).eq("carrier_id", c.carrierId).eq("id", i.id);
            if (spec.kind) q = q.eq("kind", spec.kind);
            await write(q, undo([i]));
          }
        } else {
          await write(db.from(spec.table).upsert(chunk.map(rowOf), { onConflict: conflictOf(spec), ignoreDuplicates: how === "insert" }), undo(chunk));
        }
      }

      // The office also saves removals (offers the AI dropped, a truck taken out of the fleet).
      if (c.mode === "office" && !spec.limit) {
        const ids = c.known.get(specKey(spec));
        const gone = ids ? [...ids].filter((id) => !seen.has(id)) : [];
        for (let n = 0; n < gone.length; n += 200) {
          const chunk = gone.slice(n, n + 200);
          let q = db.from(spec.table).delete().eq("carrier_id", c.carrierId).in("id", chunk);
          if (spec.kind) q = q.eq("kind", spec.kind);
          await write(q, () => {});
          if (!failed) for (const id of chunk) {
            ids!.delete(id);
            c.last.delete(itemKey(spec, id));
          }
        }
      }
    }

    if (c.mode === "office") {
      const json = stable(s.settings);
      if (json !== c.settingsJson) {
        const before = c.settingsJson;
        c.settingsJson = json;
        // Only the settings this screen changed are sent, and merged into what the database has: a change the
        // server or Backroute's team made meanwhile (moving a pilot carrier out of practice mode) isn't undone.
        const patch = settingsPatch(before, s.settings as unknown as Record<string, unknown>);
        await write(db.rpc("merge_carrier_settings", { p_carrier: c.carrierId, p_patch: patch, p_owner_operator: s.settings.ownerOperator ?? false }), () => {
          c.settingsJson = before;
        });
      }
    }
  } catch {
    failed = true;
  } finally {
    c.flushing = false;
  }
  c.failures = failed ? c.failures + 1 : 0;
  useSyncStatus.setState(failed ? { state: "offline" } : { state: "saved", savedAt: Date.now() });
  if (failed) schedule(c);
  else saveView(c);
}

// ─── Hearing other screens ───────────────────────────────────────────────────

function listen(c: Connection, specs: Spec[]): RealtimeChannel {
  const db = supabase();
  // Its own name each time: the client hands back an existing channel with the same name, and one already subscribed
  // (a connect run twice, as React does in development, or a quick reconnect) can't take new listeners.
  let channel = db.channel(`carrier:${c.carrierId}:${Math.random().toString(36).slice(2, 10)}`);
  for (const table of new Set(specs.map((s) => s.table))) {
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `carrier_id=eq.${c.carrierId}` }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<string, unknown>;
      const spec = specs.find((s) => s.table === table && (!s.kind || s.kind === row.kind));
      if (!spec || conn !== c) return;
      if (payload.eventType === "DELETE") removeRemote(c, spec, String(row.id));
      else if (row.data) applyRemote(c, spec, row.data as Item);
    });
  }
  // Removals aren't sent to filtered subscriptions, so another screen's deletion shows here after a reload.
  channel.subscribe();
  return channel;
}

/**
 * What the server just changed and sent back (a load after a book request, an escalation after it was sent): shown
 * right away, and remembered as saved so this screen doesn't write it back.
 */
export function applyFromServer(slice: "loads" | "escalations" | "trucks" | "brokers", items: Item[]) {
  const c = conn;
  const spec = c && SPECS.find((s) => s.slice === slice);
  for (const item of items) {
    if (c && spec) applyRemote(c, spec, item);
    else
      useStore.setState((s) => {
        const list = s[slice] as unknown as Item[];
        return { [slice]: list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list] } as Partial<State>;
      });
  }
}

/**
 * Pull to refresh: saves what's waiting, then reads every list again, so what another screen or the server changed
 * shows now (Realtime normally brings it, but a phone that slept or lost signal can miss some). False when there's no
 * account to read from (the demo).
 */
export async function refresh(): Promise<boolean> {
  const c = conn;
  if (!c) return false;
  await flush(c);
  const specs = SPECS.filter((s) => sees(c.mode, s));
  const lists = await Promise.all(specs.map((s) => selectAll(s, c.carrierId)));
  if (conn !== c) return false;
  specs.forEach((spec, n) => {
    const there = new Set(lists[n].map((i) => i.id));
    for (const item of lists[n]) applyRemote(c, spec, item);
    // Gone from the database (removed on another screen), as long as the list isn't one cut to its newest rows.
    if (!spec.limit) for (const id of [...(c.known.get(specKey(spec)) ?? [])]) if (!there.has(id)) removeRemote(c, spec, id);
  });
  return true;
}

function applyRemote(c: Connection, spec: Spec, item: Item) {
  const key = itemKey(spec, item.id);
  const json = stable(item);
  if (c.last.get(key)?.json === json || c.sent.get(key)?.includes(json)) return;
  remember(c, spec, item, json);
  useStore.setState((s) => {
    const list = s[spec.slice] as unknown as Item[];
    const i = list.findIndex((x) => x.id === item.id);
    const next = i >= 0 ? list.map((x, n) => (n === i ? item : x)) : spec.newestFirst ? [item, ...list] : [...list, item];
    return { [spec.slice]: next } as Partial<State>;
  });
}

function removeRemote(c: Connection, spec: Spec, id: string) {
  c.last.delete(itemKey(spec, id));
  c.known.get(specKey(spec))?.delete(id);
  useStore.setState((s) => ({ [spec.slice]: (s[spec.slice] as unknown as Item[]).filter((x) => x.id !== id) }) as Partial<State>);
}
