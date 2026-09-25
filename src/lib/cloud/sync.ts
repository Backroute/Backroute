import { create } from "zustand";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./client";
import type { Membership } from "./account";
import { useStore } from "../store";
import { PRIMARY_CARRIER_ID } from "../mock-data";
import { switchToRealDockClock } from "../detention";
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
  | "brokers";

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
}

const ours = (i: Item) => i.carrierId === PRIMARY_CARRIER_ID;
const at = (k: string) => (i: Item) => String(i[k] ?? "");
const none = () => "";

const SPECS: Spec[] = [
  { slice: "drivers", table: "drivers", time: none, newestFirst: false, driver: "update" },
  { slice: "trucks", table: "trucks", time: none, newestFirst: false, driver: null, driverReads: true },
  { slice: "loads", table: "loads", mine: ours, time: at("createdAt"), newestFirst: true, driver: "update" },
  { slice: "escalations", table: "escalations", mine: ours, time: at("createdAt"), newestFirst: true, driver: null },
  { slice: "dispatchCalls", table: "dispatch_calls", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "driverMessages", table: "driver_messages", time: at("timestamp"), newestFirst: false, driver: "insert", limit: 500 },
  { slice: "activity", table: "activity", mine: (i) => !i.carrierId || ours(i), time: at("timestamp"), newestFirst: true, driver: null, limit: 80 },
  { slice: "incidents", table: "records", kind: "incident", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "maintenanceAppointments", table: "records", kind: "maintenance", time: at("createdAt"), newestFirst: true, driver: null },
  { slice: "dvirInspections", table: "records", kind: "dvir", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "timeOffRequests", table: "records", kind: "time_off", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "expenses", table: "records", kind: "expense", time: at("createdAt"), newestFirst: true, driver: "upsert" },
  { slice: "carrierMessages", table: "records", kind: "carrier_message", time: at("timestamp"), newestFirst: false, driver: null, limit: 300 },
  // Brokers the carrier added with a load; the sample brokers stay in the app only.
  { slice: "brokers", table: "records", kind: "broker", mine: ours, time: none, newestFirst: false, driver: null, driverReads: true },
];

const driverSees = (s: Spec) => s.driver !== null || !!s.driverReads;
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

export type SyncState = "saved" | "saving" | "offline";
export const useSyncStatus = create<{ state: SyncState; savedAt: number | null }>(() => ({ state: "saved", savedAt: null }));

// ─── Connection ──────────────────────────────────────────────────────────────

interface Connection {
  carrierId: string;
  mode: "office" | "driver";
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

const itemKey = (s: Spec, id: string) => `${specKey(s)}/${id}`;

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
export async function connect(m: Membership, opts: { fresh?: boolean } = {}) {
  if (conn?.carrierId === m.carrierId) return;
  disconnect();
  const mode = m.role === "driver" ? "driver" : "office";
  const db = supabase();
  const { data: carrier, error } = await db.from("carriers").select("id, name, mc, dot, owner_operator, settings").eq("id", m.carrierId).single();
  if (error) throw error;

  const specs = SPECS.filter((s) => mode === "office" || driverSees(s));
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
      // A driver's phone holds only their own things: the rest of the sample world goes.
      if (mode === "driver") for (const spec of SPECS.filter((x) => !driverSees(x))) (next as Record<string, unknown>)[spec.slice] = spec.mine ? (s[spec.slice] as unknown as Item[]).filter((i) => !spec.mine!(i)) : [];
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
}

export function disconnect() {
  if (!conn) return;
  conn.unsubscribe();
  if (conn.timer) clearTimeout(conn.timer);
  if (conn.channel) void supabase().removeChannel(conn.channel);
  conn = null;
}

/** Signs out and reloads, so the next person on this device starts clean. */
export async function signOut() {
  if (conn) await flush(conn);
  disconnect();
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
      const how = c.mode === "office" ? "upsert" : spec.driver;
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
      const rowOf = (i: Item) => rowFor(spec.table, spec.kind, c.carrierId, i, now);
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
        await write(db.from("carriers").update({ settings: s.settings, owner_operator: s.settings.ownerOperator }).eq("id", c.carrierId), () => {
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
}

// ─── Hearing other screens ───────────────────────────────────────────────────

function listen(c: Connection, specs: Spec[]): RealtimeChannel {
  const db = supabase();
  let channel = db.channel(`carrier:${c.carrierId}`);
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
